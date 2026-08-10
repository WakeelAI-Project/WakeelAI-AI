import { readFile } from "node:fs/promises";
import { PDFParse } from "pdf-parse";

const normalizeExtractedPdfText = (text) => (
  text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
);

/**
 * Extracts selectable text from a PDF file for bootstrap ingestion.
 *
 * @param {string} sourcePath
 * @returns {Promise<string>}
 */
export const extractTextFromPdfFile = async (sourcePath) => {
  const pdfBuffer = await readFile(sourcePath);
  const parser = new PDFParse({ data: pdfBuffer });

  try {
    const result = await parser.getText();
    return normalizeExtractedPdfText(result?.text || "");
  } finally {
    await parser.destroy();
  }
};

