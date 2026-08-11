import { jest } from "@jest/globals";

jest.unstable_mockModule("../src/config/env.js", () => ({
  config: {
    VECTOR_INDEX_NAME: "test_vector_index",
  },
}));

const {
  KNOWLEDGE_VECTOR_COLLECTION,
  KNOWLEDGE_VECTOR_DIMENSIONS,
  KNOWLEDGE_VECTOR_FIELD,
  KNOWLEDGE_VECTOR_SIMILARITY,
  knowledgeVectorIndexDefinition,
  getKnowledgeVectorSearchIndexDescription,
} = await import("../src/rag/vector/knowledge-vector-index.config.js");

describe("knowledge vector index configuration", () => {
  it("uses the required collection, vector field, dimensions, similarity, and configured index name", () => {
    expect(KNOWLEDGE_VECTOR_COLLECTION).toBe("knowledge_chunks");
    expect(KNOWLEDGE_VECTOR_FIELD).toBe("embedding");
    expect(KNOWLEDGE_VECTOR_DIMENSIONS).toBe(1024);
    expect(KNOWLEDGE_VECTOR_SIMILARITY).toBe("cosine");

    expect(getKnowledgeVectorSearchIndexDescription()).toEqual({
      name: "test_vector_index",
      type: "vectorSearch",
      definition: knowledgeVectorIndexDefinition,
    });
  });

  it("indexes metadata fields required for tenant-safe pre-filtering", () => {
    expect(knowledgeVectorIndexDefinition).toEqual({
      fields: [
        {
          type: "vector",
          path: "embedding",
          numDimensions: 1024,
          similarity: "cosine",
        },
        {
          type: "filter",
          path: "sourceType",
        },
        {
          type: "filter",
          path: "companyId",
        },
        {
          type: "filter",
          path: "documentId",
        },
        {
          type: "filter",
          path: "scope",
        },
      ],
    });
  });
});

