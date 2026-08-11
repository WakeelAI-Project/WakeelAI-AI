import { jest } from "@jest/globals";

const mockGenerateEmbedding = jest.fn();
const mockSearchKnowledgeChunksByVector = jest.fn();

jest.unstable_mockModule("../src/config/env.js", () => ({
  config: {
    VECTOR_INDEX_NAME: "test_vector_index",
    KNOWLEDGE_RETRIEVAL_TOP_K: "3",
  },
}));

jest.unstable_mockModule("../src/llm/embeddings.js", () => ({
  generateEmbedding: mockGenerateEmbedding,
}));

jest.unstable_mockModule("../src/data-access/knowledge-repository.js", () => ({
  searchKnowledgeChunksByVector: mockSearchKnowledgeChunksByVector,
}));

const {
  buildKnowledgeVectorFilter,
  retrieveKnowledge,
} = await import("../src/rag/retrieval/knowledge-retrieval.service.js");

describe("KnowledgeRetrievalService", () => {
  const queryVector = Array.from({ length: 1024 }, () => 0.25);

  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateEmbedding.mockResolvedValue(queryVector);
    mockSearchKnowledgeChunksByVector.mockResolvedValue([
      {
        documentId: "labor-law-v1",
        title: "Egyptian Labor Law",
        content: "Relevant labor law chunk.",
        sourceType: "labor-law",
        scope: "global",
        companyId: null,
        chunkIndex: 7,
        knowledgeVersion: "initial",
        sourcePath: "knowledge/egyptian-labor-law.pdf",
        metadata: {},
        score: 0.91,
      },
    ]);
  });

  it("builds a labor-law filter with global scope", () => {
    expect(buildKnowledgeVectorFilter({ sourceType: "labor-law" })).toEqual({
      $and: [
        { sourceType: "labor-law" },
        { scope: "global" },
      ],
    });
  });

  it("builds a company-policy filter scoped to the requesting company", () => {
    expect(buildKnowledgeVectorFilter({
      sourceType: "company-policy",
      companyId: "company-a",
    })).toEqual({
      $and: [
        { sourceType: "company-policy" },
        { scope: "company" },
        { companyId: "company-a" },
      ],
    });
  });

  it("uses the existing embedding abstraction and vector search configuration", async () => {
    await retrieveKnowledge({
      query: "What are the annual leave rules?",
      context: {
        sourceType: "labor-law",
      },
    });

    expect(mockGenerateEmbedding).toHaveBeenCalledWith("What are the annual leave rules?");
    expect(mockSearchKnowledgeChunksByVector).toHaveBeenCalledWith({
      indexName: "test_vector_index",
      vectorPath: "embedding",
      queryVector,
      filter: {
        $and: [
          { sourceType: "labor-law" },
          { scope: "global" },
        ],
      },
      limit: 3,
      numCandidates: 60,
    });
  });

  it("enforces company-policy tenant filtering in vector search", async () => {
    mockSearchKnowledgeChunksByVector.mockResolvedValueOnce([
      {
        documentId: "policy-a",
        title: "Company A Policy",
        content: "Company A policy chunk.",
        sourceType: "company-policy",
        scope: "company",
        companyId: "company-a",
        chunkIndex: 0,
        metadata: {},
        score: 0.95,
      },
    ]);

    await retrieveKnowledge({
      query: "What is my company leave policy?",
      context: {
        sourceType: "company-policy",
        companyId: "company-a",
      },
    });

    expect(mockSearchKnowledgeChunksByVector.mock.calls[0][0].filter).toEqual({
      $and: [
        { sourceType: "company-policy" },
        { scope: "company" },
        { companyId: "company-a" },
      ],
    });
  });

  it("does not expose another company's policy chunks if returned by a misconfigured search", async () => {
    mockSearchKnowledgeChunksByVector.mockResolvedValueOnce([
      {
        documentId: "policy-b",
        title: "Company B Policy",
        content: "Company B policy chunk.",
        sourceType: "company-policy",
        scope: "company",
        companyId: "company-b",
        chunkIndex: 0,
        metadata: {},
        score: 0.99,
      },
      {
        documentId: "policy-a",
        title: "Company A Policy",
        content: "Company A policy chunk.",
        sourceType: "company-policy",
        scope: "company",
        companyId: "company-a",
        chunkIndex: 1,
        metadata: {},
        score: 0.88,
      },
    ]);

    const result = await retrieveKnowledge({
      query: "What is my company leave policy?",
      context: {
        sourceType: "company-policy",
        companyId: "company-a",
      },
    });

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].companyId).toBe("company-a");
    expect(result.sources).toHaveLength(1);
  });

  it("fails safely when company-policy retrieval has no companyId", async () => {
    await expect(retrieveKnowledge({
      query: "What is my policy?",
      context: {
        sourceType: "company-policy",
      },
    })).rejects.toMatchObject({
      code: "TENANT_CONTEXT_REQUIRED",
      status: 400,
    });

    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
    expect(mockSearchKnowledgeChunksByVector).not.toHaveBeenCalled();
  });

  it("adds documentId filtering when provided", async () => {
    await retrieveKnowledge({
      query: "Find this document",
      context: {
        sourceType: "labor-law",
        documentId: "labor-law-v1",
      },
    });

    expect(mockSearchKnowledgeChunksByVector.mock.calls[0][0].filter).toEqual({
      $and: [
        { sourceType: "labor-law" },
        { scope: "global" },
        { documentId: "labor-law-v1" },
      ],
    });
  });

  it("returns chunks and sources without embedding vectors", async () => {
    const result = await retrieveKnowledge({
      query: "What does labor law say?",
      context: {
        sourceType: "labor-law",
      },
    });

    expect(result).toEqual({
      chunks: [
        {
          documentId: "labor-law-v1",
          title: "Egyptian Labor Law",
          content: "Relevant labor law chunk.",
          sourceType: "labor-law",
          scope: "global",
          companyId: null,
          chunkIndex: 7,
          similarityScore: 0.91,
          knowledgeVersion: "initial",
          sourcePath: "knowledge/egyptian-labor-law.pdf",
          metadata: {},
        },
      ],
      sources: [
        {
          id: "labor-law-v1:7",
          title: "Egyptian Labor Law",
          type: "labor-law",
          content: "Relevant labor law chunk.",
          metadata: {
            documentId: "labor-law-v1",
            sourceType: "labor-law",
            scope: "global",
            companyId: null,
            chunkIndex: 7,
            similarityScore: 0.91,
            knowledgeVersion: "initial",
            sourcePath: "knowledge/egyptian-labor-law.pdf",
          },
        },
      ],
    });
    expect(result.chunks[0].embedding).toBeUndefined();
  });

  it("handles invalid query embeddings with a controlled error", async () => {
    mockGenerateEmbedding.mockResolvedValueOnce([0.1, 0.2]);

    await expect(retrieveKnowledge({
      query: "Bad embedding",
      context: {
        sourceType: "labor-law",
      },
    })).rejects.toMatchObject({
      code: "EMBEDDING_GENERATION_FAILED",
      status: 502,
    });
  });

  it("handles missing vector index errors without leaking internals", async () => {
    mockSearchKnowledgeChunksByVector.mockRejectedValueOnce(
      new Error("MongoServerError: vector search index test_vector_index does not exist on cluster secret-host")
    );

    await expect(retrieveKnowledge({
      query: "What does labor law say?",
      context: {
        sourceType: "labor-law",
      },
    })).rejects.toMatchObject({
      code: "VECTOR_INDEX_UNAVAILABLE",
      status: 503,
      message: "Knowledge vector index is not available. Verify VECTOR_INDEX_NAME and MongoDB Atlas Vector Search setup.",
    });
  });

  it("rejects empty queries before embedding generation", async () => {
    await expect(retrieveKnowledge({
      query: " ",
      context: {
        sourceType: "labor-law",
      },
    })).rejects.toMatchObject({
      code: "KNOWLEDGE_RETRIEVAL_VALIDATION_ERROR",
      status: 400,
    });

    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
  });
});

