import { jest } from "@jest/globals";

const mockIsKnowledgeVersionIngested = jest.fn();
const mockIngestKnowledgeDocument = jest.fn();
const mockExtractTextFromPdfFile = jest.fn();

jest.unstable_mockModule("../src/config/env.js", () => ({
  config: {
    INITIAL_LABOR_LAW_DOCUMENT_ID: "egyptian-labor-law",
    INITIAL_LABOR_LAW_TITLE: "Egyptian Labor Law",
    INITIAL_LABOR_LAW_VERSION: "initial",
    INITIAL_LABOR_LAW_SOURCE_PATH: "knowledge/egyptian-labor-law.pdf",
  },
}));

jest.unstable_mockModule("../src/data-access/knowledge-repository.js", () => ({
  isKnowledgeVersionIngested: mockIsKnowledgeVersionIngested,
}));

jest.unstable_mockModule("../src/rag/ingestion/knowledge-ingestion.service.js", () => ({
  ingestKnowledgeDocument: mockIngestKnowledgeDocument,
}));

jest.unstable_mockModule("../src/rag/ingestion/pdf-text-extractor.js", () => ({
  extractTextFromPdfFile: mockExtractTextFromPdfFile,
}));

const { bootstrapInitialLaborLawKnowledge } = await import("../src/rag/ingestion/knowledge-bootstrap.service.js");

describe("bootstrapInitialLaborLawKnowledge", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsKnowledgeVersionIngested.mockResolvedValue(false);
    mockExtractTextFromPdfFile.mockResolvedValue("Egyptian labor law source text.");
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
    expect(mockExtractTextFromPdfFile).not.toHaveBeenCalled();
    expect(mockIngestKnowledgeDocument).not.toHaveBeenCalled();
  });

  it("extracts text from the configured PDF and ingests it when the version is missing", async () => {
    const result = await bootstrapInitialLaborLawKnowledge();

    expect(result).toEqual({
      success: true,
      documentId: "egyptian-labor-law",
      chunksCreated: 1,
    });
    expect(mockExtractTextFromPdfFile).toHaveBeenCalledWith(
      expect.stringMatching(/knowledge[\\/]+egyptian-labor-law\.pdf$/)
    );
    expect(mockIngestKnowledgeDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "global",
        sourceType: "labor-law",
        documentId: "egyptian-labor-law",
        title: "Egyptian Labor Law",
        content: "Egyptian labor law source text.",
        knowledgeVersion: "initial",
        sourcePath: expect.any(String),
      }),
      { replaceExisting: false }
    );
  });

  it("fails clearly when the configured PDF is missing", async () => {
    const missingPdfError = new Error("missing file");
    missingPdfError.code = "ENOENT";
    mockExtractTextFromPdfFile.mockRejectedValueOnce(missingPdfError);

    await expect(bootstrapInitialLaborLawKnowledge()).rejects.toMatchObject({
      code: "KNOWLEDGE_BOOTSTRAP_FAILED",
      status: 500,
      message: expect.stringContaining("PDF source document was not found"),
    });
    expect(mockIngestKnowledgeDocument).not.toHaveBeenCalled();
  });

  it("fails clearly when the PDF has no extractable text", async () => {
    mockExtractTextFromPdfFile.mockResolvedValueOnce("   ");

    await expect(bootstrapInitialLaborLawKnowledge()).rejects.toMatchObject({
      code: "KNOWLEDGE_BOOTSTRAP_FAILED",
      status: 500,
      message: expect.stringContaining("OCR would be required"),
    });
    expect(mockIngestKnowledgeDocument).not.toHaveBeenCalled();
  });
});
