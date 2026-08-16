import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import request from "supertest";

// 1. Mock dependencies BEFORE importing app/routes
jest.unstable_mockModule("../src/rag/retrieval/knowledge-retrieval.service.js", () => ({
  retrieveKnowledge: jest.fn(),
}));
jest.unstable_mockModule("../src/services/company-context.service.js", () => ({
  getCompanyContext: jest.fn(),
}));

const invokeMock = jest.fn();
jest.unstable_mockModule("../src/llm/llm-provider.js", () => {
  return {
    createLLM: jest.fn().mockReturnValue({
      withStructuredOutput: jest.fn().mockReturnValue({
        invoke: invokeMock,
      }),
      invoke: invokeMock,
    }),
  };
});

// 2. Import the mocks to control them
const { retrieveKnowledge } = await import("../src/rag/retrieval/knowledge-retrieval.service.js");
const { getCompanyContext } = await import("../src/services/company-context.service.js");
const { createLLM } = await import("../src/llm/llm-provider.js");

// 3. Import app
const { default: app } = await import("../src/app.js");
const { config } = await import("../src/config/env.js");

describe("POST /api/ai/template-clauses", () => {
  const VALID_API_KEY = config.WAKEEL_INTERNAL_API_KEY || "test-internal-key";
  const COMPANY_ID = "company-123";
  const USER_ID = "user-123";

  beforeEach(() => {
    jest.clearAllMocks();

    getCompanyContext.mockResolvedValue({ industry: "Tech" });

    // Default retrieval mock: return one valid source
    retrieveKnowledge.mockImplementation(async ({ context }) => {
      return {
        sources: [
          {
            id: `doc-1:${context.knowledgeType}`,
            title: "Mock Title",
            type: context.knowledgeType,
            content: "Mock Content",
            metadata: {
              documentId: "doc-1",
              knowledgeType: context.knowledgeType,
              chunkIndex: 0,
              similarityScore: 0.95
            }
          }
        ]
      };
    });
  });

  const makeRequest = (body = {}, headers = {}) => {
    const req = request(app)
      .post("/api/ai/template-clauses")
      .send(body);

    if (headers["X-Internal-API-Key"] !== null) {
      req.set("X-Internal-API-Key", headers["X-Internal-API-Key"] || VALID_API_KEY);
    }
    req.set("X-User-Id", headers["X-User-Id"] || USER_ID);
    req.set("X-Company-Id", headers["X-Company-Id"] || COMPANY_ID);
    req.set("X-Role", headers["X-Role"] || "HR_Manager");

    return req;
  };

  const validBody = {
    templateId: "tpl-1",
    documentType: "contract",
    templateName: "Employment Contract",
    companyId: COMPANY_ID,
    language: "en",
    includeLaborLaw: true,
    includeCompanyPolicy: true,
    instruction: "Make it formal"
  };

  it("1. Valid HR request (en) -> 200, clauses grounded, each clause has sources", async () => {
    invokeMock.mockResolvedValue({
      clauses: [
        {
          title: "Working Hours",
          content: "Standard hours.",
          category: "labor_law",
          source_ids: ["doc-1:labor-law"],
          support: "supported"
        }
      ]
    });

    const response = await makeRequest(validBody);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.clauses).toHaveLength(1);
    expect(response.body.clauses[0].sources[0].id).toBe("doc-1:labor-law");
  });

  it("2. Valid HR request (ar) -> 200, prompt/language propagated as 'ar'", async () => {
    invokeMock.mockResolvedValue({ clauses: [] });
    retrieveKnowledge.mockResolvedValue({ sources: [] }); // LLM won't be invoked if no sources, but we just want to check retrieval query

    const response = await makeRequest({ ...validBody, language: "ar" });

    // Since no sources, it returns success: false, but let's check retrieval was called with Arabic
    expect(retrieveKnowledge).toHaveBeenCalled();
    const callArgs = retrieveKnowledge.mock.calls[0][0];
    expect(callArgs.query).toContain("بنود");
  });

  it("3. Company-policy retrieval called with knowledgeType: 'company-policy' AND the TRUSTED companyId", async () => {
    invokeMock.mockResolvedValue({ clauses: [] });
    await makeRequest({ ...validBody, includeLaborLaw: false, includeCompanyPolicy: true });

    expect(retrieveKnowledge).toHaveBeenCalledTimes(1);
    expect(retrieveKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          knowledgeType: "company-policy",
          companyId: COMPANY_ID
        })
      })
    );
  });

  it("4. Labor-law retrieval called with knowledgeType: 'labor-law' and NO companyId", async () => {
    invokeMock.mockResolvedValue({ clauses: [] });
    await makeRequest({ ...validBody, includeLaborLaw: true, includeCompanyPolicy: false });

    expect(retrieveKnowledge).toHaveBeenCalledTimes(1);
    const context = retrieveKnowledge.mock.calls[0][0].context;
    expect(context.knowledgeType).toBe("labor-law");
    expect(context.companyId).toBeUndefined();
  });

  it("5. Both flags enabled -> both retrievals invoked", async () => {
    invokeMock.mockResolvedValue({ clauses: [] });
    await makeRequest(validBody);

    expect(retrieveKnowledge).toHaveBeenCalledTimes(2);
    const types = retrieveKnowledge.mock.calls.map(c => c[0].context.knowledgeType);
    expect(types).toContain("labor-law");
    expect(types).toContain("company-policy");
  });

  it("6. Tenant isolation: body companyId != header X-Company-Id -> 403", async () => {
    const response = await makeRequest({ ...validBody, companyId: "rogue-tenant" });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("IDENTITY_CONTEXT_MISMATCH");
    expect(retrieveKnowledge).not.toHaveBeenCalled();
  });

  it("7. Role guard: X-Role = 'Employee' -> 403 FORBIDDEN_ROLE", async () => {
    const response = await makeRequest(validBody, { "X-Role": "Employee" });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN_ROLE");
    expect(retrieveKnowledge).not.toHaveBeenCalled();
  });

  it("8. No sources retrieved -> { success:false }, LLM NEVER invoked", async () => {
    retrieveKnowledge.mockResolvedValue({ sources: [] });

    const response = await makeRequest(validBody);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(false);
    expect(response.body.clauses).toHaveLength(0);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("9. LLM returns a clause citing a non-existent source id -> clause is dropped", async () => {
    invokeMock.mockResolvedValue({
      clauses: [
        {
          title: "Valid",
          content: "Valid content",
          category: "labor_law",
          source_ids: ["doc-1:labor-law"], // Exists from mock
          support: "supported"
        },
        {
          title: "Hallucinated",
          content: "Fake content",
          category: "labor_law",
          source_ids: ["made-up-id"], // Doesn't exist
          support: "supported"
        }
      ]
    });

    const response = await makeRequest(validBody);

    expect(response.status).toBe(200);
    expect(response.body.clauses).toHaveLength(1);
    expect(response.body.clauses[0].title).toBe("Valid");
  });

  it("10. Source metadata preserved byte-for-byte from retrieval", async () => {
    invokeMock.mockResolvedValue({
      clauses: [
        {
          title: "Valid",
          content: "Valid content",
          category: "labor_law",
          source_ids: ["doc-1:labor-law"],
          support: "supported"
        }
      ]
    });

    const response = await makeRequest(validBody);
    const metadata = response.body.clauses[0].sources[0].metadata;
    expect(metadata.similarityScore).toBe(0.95);
    expect(metadata.chunkIndex).toBe(0);
  });

  it("11. Invalid input (missing templateId) -> 400 VALIDATION_ERROR", async () => {
    const response = await makeRequest({ ...validBody, templateId: undefined });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("12. Missing X-Internal-API-Key -> 401/403 per existing behavior", async () => {
    const response = await makeRequest(validBody, { "X-Internal-API-Key": null });

    expect(response.status).toBe(401); // Or 403 depending on implementation, InternalAuth gives 401
    expect(response.body.error.code).toBe("UNAUTHORIZED_SERVICE");
  });
});
