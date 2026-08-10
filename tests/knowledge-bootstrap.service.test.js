import { jest } from "@jest/globals";

const mockReadFile = jest.fn();
const mockIsKnowledgeVersionIngested = jest.fn();
const mockIngestKnowledgeDocument = jest.fn();

jest.unstable_mockModule("node:fs/promises", () => ({
  readFile: mockReadFile,
}));

jest.unstable_mockModule("../src/config/env.js", () => ({
  config: {
    INITIAL_LABOR_LAW_DOCUMENT_ID: "egyptian-labor-law",
    INITIAL_LABOR_LAW_TITLE: "Egyptian Labor Law",
    INITIAL_LABOR_LAW_VERSION: "initial",
    INITIAL_LABOR_LAW_SOURCE_PATH: "knowledge/egyptian-labor-law.txt",
  },
}));

jest.unstable_mockModule("../src/data-access/knowledge-repository.js", () => ({
  isKnowledgeVersionIngested: mockIsKnowledgeVersionIngested,
}));

jest.unstable_mockModule("../src/rag/ingestion/knowledge-ingestion.service.js", () => ({
  ingestKnowledgeDocument: mockIngestKnowledgeDocument,
}));

const { bootstrapInitialLaborLawKnowledge } = await import("../src/rag/ingestion/knowledge-bootstrap.service.js");

describe("bootstrapInitialLaborLawKnowledge", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsKnowledgeVersionIngested.mockResolvedValue(false);
    mockReadFile.mockResolvedValue("Egyptian labor law source text.");
    mockIngestKnowledgeDocument.mockResolvedValue({
      success: true,
      documentId: "egyptian-labor-law",
      chunksCreated: 1,
    });
  });

  it("skips bootstrap when the configured labor-law version already exists", async () => {
    mockIsKnowledgeVersionIngested.mockResolvedValueOnce(true);

    const result = await bootstrapInitialLaborLawKnowledge();

    expect(result).toEqual({
      success: true,
      documentId: "egyptian-labor-law",
      chunksCreated: 0,
      skipped: true,
    });
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockIngestKnowledgeDocument).not.toHaveBeenCalled();
  });

  it("ingests the configured labor-law source when the version is missing", async () => {
    const result = await bootstrapInitialLaborLawKnowledge();

    expect(result).toEqual({
      success: true,
      documentId: "egyptian-labor-law",
      chunksCreated: 1,
    });
    expect(mockIngestKnowledgeDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "global",
        knowledgeType: "labor-law",
        documentId: "egyptian-labor-law",
        title: "Egyptian Labor Law",
        content: "Egyptian labor law source text.",
        knowledgeVersion: "initial",
        sourcePath: expect.any(String),
      }),
      { replaceExisting: false }
    );
  });
});

