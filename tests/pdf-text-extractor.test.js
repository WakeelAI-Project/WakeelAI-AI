import { jest } from "@jest/globals";

const mockReadFile = jest.fn();
const mockGetText = jest.fn();
const mockDestroy = jest.fn();
const mockPDFParse = jest.fn().mockImplementation(() => ({
  getText: mockGetText,
  destroy: mockDestroy,
}));

jest.unstable_mockModule("node:fs/promises", () => ({
  readFile: mockReadFile,
}));

jest.unstable_mockModule("pdf-parse", () => ({
  PDFParse: mockPDFParse,
}));

const { extractTextFromPdfFile } = await import("../src/rag/ingestion/pdf-text-extractor.js");

describe("extractTextFromPdfFile", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetText.mockResolvedValue({
      text: " Egyptian labor law text.\n\n\nArticle text. ",
    });
    mockDestroy.mockResolvedValue();
  });

  it("reads the PDF as binary data and extracts normalized text", async () => {
    const pdfBuffer = Buffer.from("%PDF-1.7 test content");
    mockReadFile.mockResolvedValueOnce(pdfBuffer);

    const text = await extractTextFromPdfFile("knowledge/egyptian-labor-law.pdf");

    expect(mockReadFile).toHaveBeenCalledWith("knowledge/egyptian-labor-law.pdf");
    expect(mockPDFParse).toHaveBeenCalledWith({ data: pdfBuffer });
    expect(mockGetText).toHaveBeenCalledTimes(1);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
    expect(text).toBe("Egyptian labor law text.\n\nArticle text.");
  });

  it("surfaces missing PDF read errors", async () => {
    const missingPdfError = new Error("missing file");
    missingPdfError.code = "ENOENT";
    mockReadFile.mockRejectedValueOnce(missingPdfError);

    await expect(extractTextFromPdfFile("missing.pdf")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(mockPDFParse).not.toHaveBeenCalled();
  });
});

