import { config } from "../../config/env.js";

export const KNOWLEDGE_VECTOR_COLLECTION = "knowledge_chunks";
export const KNOWLEDGE_VECTOR_FIELD = "embedding";
export const KNOWLEDGE_VECTOR_DIMENSIONS = 1024;
export const KNOWLEDGE_VECTOR_SIMILARITY = "cosine";
export const KNOWLEDGE_VECTOR_FILTER_FIELDS = [
  "sourceType",
  "companyId",
  "documentId",
  "scope",
];

export const knowledgeVectorIndexDefinition = Object.freeze({
  fields: Object.freeze([
    Object.freeze({
      type: "vector",
      path: KNOWLEDGE_VECTOR_FIELD,
      numDimensions: KNOWLEDGE_VECTOR_DIMENSIONS,
      similarity: KNOWLEDGE_VECTOR_SIMILARITY,
    }),
    ...KNOWLEDGE_VECTOR_FILTER_FIELDS.map((path) => Object.freeze({
      type: "filter",
      path,
    })),
  ]),
});

export const getKnowledgeVectorSearchIndexDescription = () => ({
  name: config.VECTOR_INDEX_NAME,
  type: "vectorSearch",
  definition: knowledgeVectorIndexDefinition,
});

