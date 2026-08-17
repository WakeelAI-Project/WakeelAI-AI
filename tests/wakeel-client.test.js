import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

jest.unstable_mockModule("../src/config/env.js", () => ({
  config: {
    WAKEEL_API_BASE_URL: "https://wakeel-ai-api.runasp.net",
    WAKEEL_INTERNAL_API_KEY: "test-internal-key",
  },
}));

jest.unstable_mockModule("../src/shared/logger.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const { wakeelFetch } = await import("../src/integrations/wakeel/wakeel-client.js");
const { logger } = await import("../src/shared/logger.js");

describe("Wakeel client", () => {
  const aiContext = {
    userId: "user-1",
    companyId: "company-1",
    role: "Employee",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    delete global.fetch;
  });

  it("requests the configured .NET URL with trusted non-body identity headers", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        id: "company-1",
        name: "Wakeel Technologies",
        industry: "Technology",
      }),
    });

    const result = await wakeelFetch("GET", "/api/ai/company-context", aiContext);

    expect(global.fetch).toHaveBeenCalledWith(
      "https://wakeel-ai-api.runasp.net/api/ai/company-context",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "X-Internal-API-Key": "test-internal-key",
          "X-User-Id": "user-1",
          "X-Company-Id": "company-1",
          "X-Role": "Employee",
        }),
      })
    );
    expect(result).toEqual(expect.objectContaining({
      id: "company-1",
      name: "Wakeel Technologies",
    }));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("-> GET /api/ai/company-context"));
  });

  it("fails before fetch when trusted companyId is missing", async () => {
    await expect(
      wakeelFetch("GET", "/api/ai/company-context", { ...aiContext, companyId: "" })
    ).rejects.toThrow("Missing required trusted AI context");

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns backend status and safe body summary on company-context API failure", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ error: "boom", trace: "hidden-in-final-report" }),
    });

    await expect(
      wakeelFetch("GET", "/api/ai/company-context", aiContext)
    ).rejects.toMatchObject({
      code: "BACKEND_ERROR",
      status: 500,
      responseSummary: {
        fields: ["error", "trace"],
      },
    });
  });
});
