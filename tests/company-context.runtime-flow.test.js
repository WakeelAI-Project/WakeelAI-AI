import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

process.env.NODE_ENV = "test";
process.env.PORT = "3000";
process.env.MONGODB_URI = "mongodb://localhost:27017/test";
process.env.MONGODB_DB_NAME = "wakeel_ai_test";
process.env.LLM_API_KEY = "test-llm-key";
process.env.LLM_MODEL = "test-model";
process.env.LLM_BASE_URL = "https://llm.test";
process.env.HUGGINGFACE_API_KEY = "test-hf-key";
process.env.EMBEDDING_PROVIDER = "huggingface";
process.env.EMBEDDING_MODEL = "BAAI/bge-m3";
process.env.WAKEEL_API_BASE_URL = "https://wakeel-ai-api.runasp.net";
process.env.WAKEEL_INTERNAL_API_KEY = "test-internal-key";
process.env.VECTOR_INDEX_NAME = "test_vector_index";
process.env.KNOWLEDGE_RETRIEVAL_TOP_K = "5";
process.env.KNOWLEDGE_CHUNK_SIZE = "1200";
process.env.INITIAL_LABOR_LAW_DOCUMENT_ID = "labor-law";
process.env.INITIAL_LABOR_LAW_TITLE = "Labor Law";
process.env.INITIAL_LABOR_LAW_VERSION = "test";
process.env.INITIAL_LABOR_LAW_SOURCE_PATH = "knowledge/egypt-labor-law-14-2025.pdf";

jest.unstable_mockModule("../src/shared/logger.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const { handleChat } = await import("../src/orchestrator/orchestrator.service.js");
const { logger } = await import("../src/shared/logger.js");

const getLogMessages = () => [
  ...logger.info.mock.calls.map(([message]) => message),
  ...logger.warn.mock.calls.map(([message]) => message),
  ...logger.error.mock.calls.map(([message]) => message),
  ...logger.debug.mock.calls.map(([message]) => message),
].join("\n");

describe("Company context runtime flow diagnostic", () => {
  let finalLlmPayload;

  beforeEach(() => {
    jest.clearAllMocks();
    finalLlmPayload = null;

    global.fetch = jest.fn(async (url, options = {}) => {
      if (String(url) === "https://wakeel-ai-api.runasp.net/api/ai/company-context") {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            id: "company-runtime-1",
            name: "Runtime Test Company",
            tax_id: "redacted-tax-id",
            industry: "Technology",
            address: "Cairo",
            phone_number: null,
            email: null,
            logo_url: null,
            working_hours: "09:00-17:00",
            registered_at: "2026-01-01T00:00:00Z",
            policy_available: true,
          }),
        };
      }

      if (String(url) === "https://llm.test/student/chat") {
        const payload = JSON.parse(options.body);

        if (payload.system_prompt.includes("determine their intent")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              output_text: JSON.stringify({
                intent: "company_question",
                requiresCapabilities: [],
                requiresContext: ["company"],
              }),
            }),
          };
        }

        finalLlmPayload = payload;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            output_text: "Your company name is Runtime Test Company.",
          }),
        };
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });
  });

  afterEach(() => {
    delete global.fetch;
  });

  it("executes handleChat -> boundary -> CompanyContextService -> CompanyAPI -> wakeelFetch for company name", async () => {
    const result = await handleChat({
      message: "what is my company name",
      conversationId: "runtime-company-context",
      context: {
        userId: "user-runtime-1",
        companyId: "company-runtime-1",
        role: "HR_Manager",
      },
    });

    expect(result.message).toContain("Runtime Test Company");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://wakeel-ai-api.runasp.net/api/ai/company-context",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "X-Internal-API-Key": "test-internal-key",
          "X-Company-Id": "company-runtime-1",
          "X-User-Id": "user-runtime-1",
          "X-Role": "HR_Manager",
        }),
      })
    );

    expect(finalLlmPayload.system_prompt).toContain('"companyName": "Runtime Test Company"');

    const logs = getLogMessages();
    expect(logs).toContain('[Orchestrator] Received message: "what is my company name"');
    expect(logs).toContain("[Orchestrator] Intent detection started");
    expect(logs).toContain('"intent":"company_question"');
    expect(logs).toContain('"requiresContext":["company"]');
    expect(logs).toContain("[ContextBoundary] gatherContextBoundary called");
    expect(logs).toContain("[ContextBoundary] Processing context type = company");
    expect(logs).toContain("[ContextBoundary] Calling CompanyContextService...");
    expect(logs).toContain("[CompanyContextService] >>> ENTERED getCompanyContext <<<");
    expect(logs).toContain("[CompanyContextService] companyId present = true");
    expect(logs).toContain("[CompanyContextService] >>> CALLING getCompanyContextApi <<<");
    expect(logs).toContain("[CompanyAPI] >>> ENTERED getCompanyContextApi <<<");
    expect(logs).toContain("[CompanyAPI] endpoint = /api/ai/company-context");
    expect(logs).toContain("[WakeelClient] -> GET /api/ai/company-context");
    expect(logs).toContain("[WakeelClient] <- GET /api/ai/company-context status=200");
    expect(logs).toContain("[CompanyContextService] >>> VALIDATION PASSED <<<");
    expect(logs).toContain("[CompanyContextService] companyName present = true");
    expect(logs).toContain("[ContextBoundary] Company context successfully gathered");
    expect(logs).toContain("company name present=true");
    expect(logs).toContain("contains actual companyName=true");
    expect(logs).toContain("[Orchestrator] Sending final prompt to LLM");
  });
});
