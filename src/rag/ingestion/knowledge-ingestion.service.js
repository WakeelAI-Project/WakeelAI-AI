import { config } from "../../config/env.js";
import { replaceKnowledgeChunks, insertKnowledgeChunks } from "../../data-access/knowledge-repository.js";
import { generateEmbedding, generateEmbeddings } from "../../llm/embeddings.js";
import { logger } from "../../shared/logger.js";
import { chunkDocumentContent } from "./chunker.js";
import { KnowledgeIngestionInputSchema } from "./knowledge-ingestion.schema.js";

const createServiceError = ({ message, code, status }) => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
};

const getConfiguredChunkSize = () => {
  const chunkSize = Number(config.KNOWLEDGE_CHUNK_SIZE);
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw createServiceError({
      message: "Invalid knowledge chunk size configuration.",
      code: "KNOWLEDGE_CONFIGURATION_ERROR",
      status: 500,
    });
  }

  return chunkSize;
};

const normalizeInput = (input) => {
  const parsed = KnowledgeIngestionInputSchema.safeParse(input);
  if (!parsed.success) {
    throw createServiceError({
      message: "Invalid knowledge ingestion input.",
      code: "VALIDATION_ERROR",
      status: 400,
    });
  }

  return parsed.data;
};

const getScopeForKnowledgeType = (knowledgeType) => (
  knowledgeType === "labor-law" ? "global" : "company"
);

const createKnowledgeChunkRecords = ({ input, chunks, embeddings, scope }) => (
  chunks.map((content, index) => ({
    documentId: input.documentId,
    companyId: scope === "company" ? input.companyId : null,
    knowledgeType: input.knowledgeType,
    scope,
    title: input.title,
    content,
    chunkIndex: index,
    embedding: embeddings[index],
    knowledgeVersion: input.knowledgeVersion ?? null,
    sourcePath: input.sourcePath ?? null,
    metadata: {
      requestCompanyId: input.companyId,
    },
  }))
);

const generateChunkEmbeddings = async (chunks) => {
  // Use batch embedding processing from the abstraction
  return generateEmbeddings(chunks);
};

/**
 * Ingests a labor-law or company-policy knowledge document into MongoDB.
 *
 * @param {Object} input
 * @param {Object} [options]
 * @param {boolean} [options.replaceExisting=true]
 * @returns {Promise<{success: boolean, documentId: string, chunksCreated: number}>}
 */
export const ingestKnowledgeDocument = async (input, options = {}) => {
  const normalizedInput = normalizeInput(input);
  const scope = getScopeForKnowledgeType(normalizedInput.knowledgeType);
  const chunkSize = getConfiguredChunkSize();
  const chunks = chunkDocumentContent(normalizedInput.content, { chunkSize });

  if (chunks.length === 0) {
    throw createServiceError({
      message: "Knowledge document content produced no chunks.",
      code: "KNOWLEDGE_CONTENT_EMPTY",
      status: 400,
    });
  }

  logger.info(
    `[KnowledgeIngestion] Starting ingestion documentId=${normalizedInput.documentId} knowledgeType=${normalizedInput.knowledgeType} scope=${scope} chunks=${chunks.length}`
  );

  let embeddings;
  try {
    embeddings = await generateChunkEmbeddings(chunks);
  } catch (error) {
    logger.error(
      `[KnowledgeIngestion] Embedding generation failed documentId=${normalizedInput.documentId} knowledgeType=${normalizedInput.knowledgeType} chunks=${chunks.length}`
    );

    throw createServiceError({
      message: "Failed to generate knowledge embeddings.",
      code: "EMBEDDING_GENERATION_FAILED",
      status: 502,
    });
  }

  const invalidEmbeddingIndex = embeddings.findIndex((embedding) => (
    !Array.isArray(embedding) || embedding.length === 0
  ));

  if (invalidEmbeddingIndex !== -1) {
    throw createServiceError({
      message: "Embedding provider returned an invalid embedding.",
      code: "EMBEDDING_GENERATION_FAILED",
      status: 502,
    });
  }

  const records = createKnowledgeChunkRecords({
    input: normalizedInput,
    chunks,
    embeddings,
    scope,
  });

  try {
    if (options.replaceExisting === false) {
      await insertKnowledgeChunks(records);
    } else {
      await replaceKnowledgeChunks({
        documentId: normalizedInput.documentId,
        knowledgeType: normalizedInput.knowledgeType,
        scope,
        companyId: scope === "company" ? normalizedInput.companyId : null,
        knowledgeVersion: normalizedInput.knowledgeVersion ?? null,
        chunks: records,
      });
    }
  } catch (error) {
    logger.error(
      `[KnowledgeIngestion] MongoDB storage failed documentId=${normalizedInput.documentId} knowledgeType=${normalizedInput.knowledgeType} chunks=${records.length}`
    );

    throw createServiceError({
      message: "Failed to store knowledge chunks.",
      code: "KNOWLEDGE_STORAGE_FAILED",
      status: 500,
    });
  }

  logger.info(
    `[KnowledgeIngestion] Completed ingestion documentId=${normalizedInput.documentId} knowledgeType=${normalizedInput.knowledgeType} scope=${scope} chunksCreated=${records.length}`
  );

  return {
    success: true,
    documentId: normalizedInput.documentId,
    chunksCreated: records.length,
  };
};
