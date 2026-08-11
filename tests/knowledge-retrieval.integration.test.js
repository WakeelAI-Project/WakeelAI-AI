import { jest } from "@jest/globals";
import { config } from "../src/config/env.js";
import { SourceSchema } from "../src/contracts/index.js";
import { connectDatabase, disconnectDatabase } from "../src/data-access/database.js";
import { KnowledgeChunk } from "../src/data-access/knowledge-chunk.model.js";
import { generateEmbedding } from "../src/llm/embeddings.js";
import { retrieveKnowledge } from "../src/rag/retrieval/knowledge-retrieval.service.js";

const shouldRunIntegrationTests = process.env.RUN_INTEGRATION_TESTS === "true";

const annualLeaveQuery = "ما هي الإجازات السنوية المستحقة للعامل؟";
const annualLeaveDurationQuery = "ما هي مدة الإجازة السنوية للعامل؟";
const documentFilteredQuery = "الإجازات السنوية";
const expectedDocumentId = "egyptian-labor-law";

const requiredEnvKeys = [
  "MONGODB_URI",
  "MONGODB_DB_NAME",
  "HUGGINGFACE_API_KEY",
  "EMBEDDING_MODEL",
  "VECTOR_INDEX_NAME",
];

const assertIntegrationConfig = () => {
  const missingKeys = requiredEnvKeys.filter((key) => !config[key]);

  if (missingKeys.length > 0) {
    throw new Error(
      `Missing required integration environment variables: ${missingKeys.join(", ")}`
    );
  }

  if (config.EMBEDDING_MODEL !== "BAAI/bge-m3") {
    throw new Error(
      `Expected EMBEDDING_MODEL to be BAAI/bge-m3, got ${config.EMBEDDING_MODEL}`
    );
  }
};

const normalizeArabicText = (text) => (
  text
    .normalize("NFKC")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ًٌٍَُِّْ]/g, "")
);

const assertLaborLawChunkShape = (chunk) => {
  expect(chunk.documentId).toEqual(expect.any(String));
  expect(chunk.title).toEqual(expect.any(String));
  expect(chunk.content).toEqual(expect.any(String));
  expect(chunk.sourceType).toBe("labor-law");
  expect(chunk.scope).toBe("global");
  expect(chunk.companyId).toBeNull();
  expect(chunk.chunkIndex).toEqual(expect.any(Number));
  expect(chunk.similarityScore).toEqual(expect.any(Number));
  expect(Number.isFinite(chunk.similarityScore)).toBe(true);
  expect(chunk.embedding).toBeUndefined();
};

const assertSourceShape = (source) => {
  const parsed = SourceSchema.safeParse(source);

  expect(parsed.success).toBe(true);
  expect(source.id).toEqual(expect.any(String));
  expect(source.metadata).toEqual(expect.objectContaining({
    documentId: expect.any(String),
    sourceType: expect.any(String),
    scope: expect.any(String),
    chunkIndex: expect.any(Number),
    similarityScore: expect.any(Number),
  }));
};

if (!shouldRunIntegrationTests) {
  describe.skip("Knowledge retrieval Atlas integration (set RUN_INTEGRATION_TESTS=true to run)", () => {
    it("is skipped by default so the normal unit suite does not hit Atlas or Hugging Face", () => {});
  });
} else {
  jest.setTimeout(180000);

  describe("Knowledge retrieval Atlas integration", () => {
    let configuredVectorIndex;
    let latestLaborLawResult;
    let latestDocumentFilterResult;
    let latestCompanyPolicyResult;

    beforeAll(async () => {
      assertIntegrationConfig();
      await connectDatabase();

      const searchIndexes = await KnowledgeChunk.listSearchIndexes();
      configuredVectorIndex = searchIndexes.find((index) => (
        index.name === config.VECTOR_INDEX_NAME
      ));

      if (!configuredVectorIndex) {
        throw new Error(
          `MongoDB Atlas Vector Search index "${config.VECTOR_INDEX_NAME}" is unavailable. Create/configure the Atlas Vector Search index before running this integration test.`
        );
      }
    });

    afterAll(async () => {
      await disconnectDatabase();
    });

    it("finds the configured Atlas Vector Search index before retrieval", () => {
      expect(configuredVectorIndex).toBeDefined();
      expect(configuredVectorIndex.name).toBe(config.VECTOR_INDEX_NAME);
    });

    it("generates a 1024-dimensional BAAI/bge-m3 query embedding", async () => {
      const queryEmbedding = await generateEmbedding(annualLeaveQuery);

      expect(Array.isArray(queryEmbedding)).toBe(true);
      expect(queryEmbedding).toHaveLength(1024);
    });

    it("retrieves global labor-law chunks through real Atlas Vector Search", async () => {
      latestLaborLawResult = await retrieveKnowledge({
        query: annualLeaveQuery,
        context: {
          sourceType: "labor-law",
          topK: 5,
        },
      });

      expect(Array.isArray(latestLaborLawResult.chunks)).toBe(true);
      expect(Array.isArray(latestLaborLawResult.sources)).toBe(true);
      expect(latestLaborLawResult.chunks.length).toBeGreaterThan(0);
      expect(latestLaborLawResult.chunks.length).toBeLessThanOrEqual(5);
      expect(latestLaborLawResult.sources).toHaveLength(latestLaborLawResult.chunks.length);

      latestLaborLawResult.chunks.forEach(assertLaborLawChunkShape);
      latestLaborLawResult.sources.forEach(assertSourceShape);
    });

    it("returns chunks semantically related to annual leave", async () => {
      const result = await retrieveKnowledge({
        query: annualLeaveDurationQuery,
        context: {
          sourceType: "labor-law",
          topK: 5,
        },
      });

      const combinedText = normalizeArabicText(
        result.chunks.map((chunk) => `${chunk.title} ${chunk.content}`).join(" ")
      );
      const annualLeaveSignals = ["اجاز", "سنوي", "عامل"];

      expect(result.chunks.length).toBeGreaterThan(0);
      expect(
        annualLeaveSignals.some((signal) => combinedText.includes(signal))
      ).toBe(true);
    });

    it("filters labor-law retrieval by documentId when provided", async () => {
      latestDocumentFilterResult = await retrieveKnowledge({
        query: documentFilteredQuery,
        context: {
          sourceType: "labor-law",
          documentId: expectedDocumentId,
          topK: 5,
        },
      });

      expect(latestDocumentFilterResult.chunks.length).toBeGreaterThan(0);
      latestDocumentFilterResult.chunks.forEach((chunk) => {
        expect(chunk.documentId).toBe(expectedDocumentId);
      });
    });

    it("fails safely when company-policy retrieval is missing companyId", async () => {
      await expect(retrieveKnowledge({
        query: "company vacation policy",
        context: {
          sourceType: "company-policy",
        },
      })).rejects.toMatchObject({
        code: "TENANT_CONTEXT_REQUIRED",
      });
    });

    it("returns numeric similarity scores", () => {
      expect(latestLaborLawResult?.chunks?.length).toBeGreaterThan(0);

      latestLaborLawResult.chunks.forEach((chunk) => {
        expect(chunk.similarityScore).toEqual(expect.any(Number));
        expect(Number.isFinite(chunk.similarityScore)).toBe(true);
      });
    });

    it("keeps company-policy retrieval constrained to the exact companyId", async () => {
      latestCompanyPolicyResult = await retrieveKnowledge({
        query: "company vacation policy",
        context: {
          sourceType: "company-policy",
          companyId: "company-A",
          topK: 5,
        },
      });

      if (latestCompanyPolicyResult.chunks.length === 0) {
        console.info(
          "No company-policy chunks were returned for company-A. Real cross-tenant data verification requires company-policy documents for at least two companies."
        );
      }

      latestCompanyPolicyResult.chunks.forEach((chunk) => {
        expect(chunk.sourceType).toBe("company-policy");
        expect(chunk.scope).toBe("company");
        expect(chunk.companyId).toBe("company-A");
        expect(chunk.companyId).not.toBe("company-B");
      });
    });
  });
}
