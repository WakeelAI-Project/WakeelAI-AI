import { z } from "zod";
import { config } from "../../config/env.js";
import { SourceSchema } from "../../contracts/index.js";
import { searchKnowledgeChunksByVector } from "../../data-access/knowledge-repository.js";
import { generateEmbedding } from "../../llm/embeddings.js";
import { logger } from "../../shared/logger.js";
import {
  KNOWLEDGE_VECTOR_DIMENSIONS,
  KNOWLEDGE_VECTOR_FIELD,
} from "../vector/knowledge-vector-index.config.js";

const NUM_CANDIDATES_MULTIPLIER = 20;
const MAX_TOP_K = 50;

const RetrievalRequestSchema = z.object({
  query: z.string().trim().min(1, "Query cannot be empty"),
  context: z.object({
    companyId: z.string().trim().min(1, "Company ID cannot be empty").optional(),
    knowledgeType: z.enum(["labor-law", "company-policy"]),
    documentId: z.string().trim().min(1, "Document ID cannot be empty").optional(),
    topK: z.number().int().positive().max(MAX_TOP_K).optional(),
  }).strict(),
}).strict();

const createRetrievalError = ({ message, code, status }) => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
};

const getConfiguredTopK = () => {
  const topK = Number(config.KNOWLEDGE_RETRIEVAL_TOP_K ?? 5);

  if (!Number.isInteger(topK) || topK <= 0 || topK > MAX_TOP_K) {
    throw createRetrievalError({
      message: `KNOWLEDGE_RETRIEVAL_TOP_K must be an integer between 1 and ${MAX_TOP_K}.`,
      code: "KNOWLEDGE_RETRIEVAL_CONFIGURATION_ERROR",
      status: 500,
    });
  }

  return topK;
};

export const buildKnowledgeVectorFilter = ({ knowledgeType, companyId, documentId }) => {
  const filters = [];

  if (knowledgeType === "labor-law") {
    filters.push(
      { knowledgeType: "labor-law" },
      { scope: "global" }
    );
  } else if (knowledgeType === "company-policy") {
    if (!companyId) {
      throw createRetrievalError({
        message: "companyId is required for company-policy retrieval.",
        code: "TENANT_CONTEXT_REQUIRED",
        status: 400,
      });
    }

    filters.push(
      { knowledgeType: "company-policy" },
      { scope: "company" },
      { companyId }
    );
  } else {
    throw createRetrievalError({
      message: "Invalid knowledgeType for retrieval.",
      code: "KNOWLEDGE_RETRIEVAL_VALIDATION_ERROR",
      status: 400,
    });
  }

  if (documentId) {
    filters.push({ documentId });
  }

  return { $and: filters };
};

const validateQueryEmbedding = (embedding) => {
  if (!Array.isArray(embedding) || embedding.length !== KNOWLEDGE_VECTOR_DIMENSIONS) {
    throw createRetrievalError({
      message: "Failed to generate a valid query embedding.",
      code: "EMBEDDING_GENERATION_FAILED",
      status: 502,
    });
  }
};

const isMissingVectorIndexError = (error) => (
  /index|vector search|search index|not found|does not exist/i.test(error?.message || "")
);

const formatChunk = (chunk) => ({
  documentId: chunk.documentId,
  title: chunk.title,
  content: chunk.content,
  knowledgeType: chunk.knowledgeType,
  scope: chunk.scope,
  companyId: chunk.companyId ?? null,
  chunkIndex: chunk.chunkIndex,
  similarityScore: chunk.score,
  knowledgeVersion: chunk.knowledgeVersion ?? null,
  sourcePath: chunk.sourcePath ?? null,
  metadata: chunk.metadata ?? {},
});

const formatSource = (chunk) => SourceSchema.parse({
  id: `${chunk.documentId}:${chunk.chunkIndex}`,
  title: chunk.title,
  type: chunk.knowledgeType,
  content: chunk.content,
  metadata: {
    documentId: chunk.documentId,
    knowledgeType: chunk.knowledgeType,
    scope: chunk.scope,
    companyId: chunk.companyId ?? null,
    chunkIndex: chunk.chunkIndex,
    similarityScore: chunk.similarityScore,
    knowledgeVersion: chunk.knowledgeVersion,
    sourcePath: chunk.sourcePath,
  },
});

const isChunkAllowedForContext = (chunk, context) => {
  if (context.documentId && chunk.documentId !== context.documentId) {
    return false;
  }

  if (context.knowledgeType === "labor-law") {
    return chunk.knowledgeType === "labor-law" && chunk.scope === "global";
  }

  return (
    chunk.knowledgeType === "company-policy"
    && chunk.scope === "company"
    && chunk.companyId === context.companyId
  );
};

/**
 * Retrieves semantically relevant knowledge chunks with tenant-safe filtering.
 *
 * @param {Object} input
 * @param {string} input.query
 * @param {Object} input.context
 * @returns {Promise<{chunks: Array<Object>, sources: Array<Object>}>}
 */
export const retrieveKnowledge = async (input) => {
  const parsed = RetrievalRequestSchema.safeParse(input);

  if (!parsed.success) {
    throw createRetrievalError({
      message: "Invalid knowledge retrieval input.",
      code: "KNOWLEDGE_RETRIEVAL_VALIDATION_ERROR",
      status: 400,
    });
  }

  const { query, context } = parsed.data;
  const topK = context.topK ?? getConfiguredTopK();
  const filter = buildKnowledgeVectorFilter(context);

  let queryVector;
  try {
    queryVector = await generateEmbedding(query);
    validateQueryEmbedding(queryVector);
  } catch (error) {
    logger.error(
      `[KnowledgeRetrieval] Query embedding failed knowledgeType=${context.knowledgeType} documentId=${context.documentId || "none"}`
    );

    if (error.code === "EMBEDDING_GENERATION_FAILED") {
      throw error;
    }

    throw createRetrievalError({
      message: "Failed to generate query embedding.",
      code: "EMBEDDING_GENERATION_FAILED",
      status: 502,
    });
  }

  let retrievedChunks;
  try {
    retrievedChunks = await searchKnowledgeChunksByVector({
      indexName: config.VECTOR_INDEX_NAME,
      vectorPath: KNOWLEDGE_VECTOR_FIELD,
      queryVector,
      filter,
      limit: topK,
      numCandidates: Math.max(topK, topK * NUM_CANDIDATES_MULTIPLIER),
    });
  } catch (error) {
    logger.error(
      `[KnowledgeRetrieval] Vector search failed knowledgeType=${context.knowledgeType} documentId=${context.documentId || "none"}`
    );

    if (isMissingVectorIndexError(error)) {
      throw createRetrievalError({
        message: "Knowledge vector index is not available. Verify VECTOR_INDEX_NAME and MongoDB Atlas Vector Search setup.",
        code: "VECTOR_INDEX_UNAVAILABLE",
        status: 503,
      });
    }

    throw createRetrievalError({
      message: "Knowledge retrieval failed.",
      code: "KNOWLEDGE_RETRIEVAL_FAILED",
      status: 500,
    });
  }

  const scopedChunks = retrievedChunks.filter((chunk) => (
    isChunkAllowedForContext(chunk, context)
  ));

  if (scopedChunks.length !== retrievedChunks.length) {
    logger.error(
      `[KnowledgeRetrieval] Dropped out-of-scope vector search results knowledgeType=${context.knowledgeType} companyId=${context.companyId || "none"}`
    );
  }

  const chunks = scopedChunks.map(formatChunk);
  const sources = chunks.map(formatSource);

  return {
    chunks,
    sources,
  };
};
