import { chunkDocumentContent } from "../src/rag/ingestion/chunker.js";

describe("chunkDocumentContent", () => {
  it("produces multiple non-empty chunks for sufficiently long content", () => {
    const content = [
      "First paragraph has enough words to stand as a meaningful section.",
      "Second paragraph also has enough words to make the configured chunk size overflow.",
      "Third paragraph confirms that the chunker keeps creating deterministic chunks.",
    ].join("\n\n");

    const chunks = chunkDocumentContent(content, { chunkSize: 90 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.trim().length > 0)).toBe(true);
  });
});

