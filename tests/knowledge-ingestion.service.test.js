import { jest } from "@jest/globals";

const mockGenerateEmbeddings = jest.fn();
const mockReplaceKnowledgeChunks = jest.fn();
const mockInsertKnowledgeChunks = jest.fn();

jest.unstable_mockModule("../src/config/env.js", () => ({
  config: {
    KNOWLEDGE_CHUNK_SIZE: "80",
  },
}));

jest.unstable_mockModule("../src/llm/embeddings.js", () => ({
  generateEmbeddings: mockGenerateEmbeddings,
  generateEmbedding: jest.fn(),
}));

jest.unstable_mockModule("../src/data-access/knowledge-repository.js", () => ({
  replaceKnowledgeChunks: mockReplaceKnowledgeChunks,
  insertKnowledgeChunks: mockInsertKnowledgeChunks,
}));

const { ingestKnowledgeDocument } = await import("../src/rag/ingestion/knowledge-ingestion.service.js");

describe("Knowledge ingestion service", () => {
  const basePayload = {
    companyId: "company-uuid",
    sourceType: "labor-law",
    documentId: "document-uuid",
    title: "Egyptian Labor Law",
    content: [
      "Article one gives a short rule about employment contracts.",
      "Article two gives another rule about annual leave.",
      "Article three gives another rule about working hours.",
      "Article four gives another rule about termination.",
    ].join(" "),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateEmbeddings.mockImplementation(async (chunks) => chunks.map(() => Array(1024).fill(1)));
    mockReplaceKnowledgeChunks.mockResolvedValue([]);
    mockInsertKnowledgeChunks.mockResolvedValue([]);
  });

  it("chunks long content and generates embeddings in batch", async () => {
    const result = await ingestKnowledgeDocument(basePayload);

    const storedInput = mockReplaceKnowledgeChunks.mock.calls[0][0];

    expect(storedInput.chunks.length).toBeGreaterThan(1);
    expect(mockGenerateEmbeddings).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: true,
      documentId: "document-uuid",
      chunksCreated: storedInput.chunks.length,
    });
  });

  it("stores labor-law chunks as global knowledge", async () => {
    await ingestKnowledgeDocument(basePayload);

    const storedInput = mockReplaceKnowledgeChunks.mock.calls[0][0];

    expect(storedInput.scope).toBe("global");
    expect(storedInput.companyId).toBeNull();
    expect(storedInput.chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          documentId: "document-uuid",
          companyId: null,
          sourceType: "labor-law",
          scope: "global",
          title: "Egyptian Labor Law",
          chunkIndex: 0,
          embedding: expect.any(Array),
          metadata: {
            requestCompanyId: "company-uuid",
          },
        }),
      ])
    );
  });

  it("stores company-policy chunks scoped to companyId", async () => {
    const payload = {
      ...basePayload,
      sourceType: "company-policy",
      title: "Company Policy",
    };

    await ingestKnowledgeDocument(payload);

    const storedInput = mockReplaceKnowledgeChunks.mock.calls[0][0];

    expect(storedInput.scope).toBe("company");
    expect(storedInput.companyId).toBe("company-uuid");
    expect(storedInput.chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          companyId: "company-uuid",
          sourceType: "company-policy",
          scope: "company",
        }),
      ])
    );
  });

  it("handles embedding failure without storing chunks", async () => {
    mockGenerateEmbeddings.mockRejectedValueOnce(new Error("provider unavailable"));

    await expect(ingestKnowledgeDocument(basePayload)).rejects.toMatchObject({
      status: 502,
      code: "EMBEDDING_GENERATION_FAILED",
    });

    expect(mockReplaceKnowledgeChunks).not.toHaveBeenCalled();
    expect(mockInsertKnowledgeChunks).not.toHaveBeenCalled();
  });

  it("handles MongoDB storage failure", async () => {
    mockReplaceKnowledgeChunks.mockRejectedValueOnce(new Error("mongo unavailable"));

    await expect(ingestKnowledgeDocument(basePayload)).rejects.toMatchObject({
      status: 500,
      code: "KNOWLEDGE_STORAGE_FAILED",
    });
  });
});

