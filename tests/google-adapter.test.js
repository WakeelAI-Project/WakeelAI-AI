import { jest } from "@jest/globals";

// ── Mock fetch globally ──────────────────────────────────────────────────────
const mockFetch = jest.fn();
global.fetch = mockFetch;

// ── Mock config ─────────────────────────────────────────────────────────────
jest.unstable_mockModule("../src/config/env.js", () => ({
  config: {
    GOOGLE_API_KEY: "test-google-api-key",
    GOOGLE_MODEL: "gemini-2.5-flash",
    GOOGLE_BASE_URL: "https://generativelanguage.googleapis.com/v1beta",
    LLM_API_KEY: "fallback-api-key",
    LLM_MODEL: "fallback-model",
    LLM_BASE_URL: "https://fallback.example.com",
  },
  llmConfig: {
    provider: "google",
    apiKey: "fallback-api-key",
    modelName: "fallback-model",
    googleApiKey: "test-google-api-key",
    googleModel: "gemini-2.5-flash",
    googleBaseURL: "https://generativelanguage.googleapis.com/v1beta",
  },
}));

const { GoogleGeminiLanguageModel } = await import(
  "../src/llm/google-adapter.js"
);
const { z } = await import("zod");

const makeGoodGeminiResponse = (
  text,
  usage = { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 }
) =>
  Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () =>
      Promise.resolve({
        candidates: [
          {
            content: {
              parts: [{ text }],
              role: "model",
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: usage,
      }),
  });

const makeErrorResponse = (status, body = "") =>
  Promise.resolve({
    ok: false,
    status,
    headers: { get: () => null },
    text: () => Promise.resolve(body),
  });

describe("GoogleGeminiLanguageModel", () => {
  let llm;

  beforeEach(() => {
    jest.clearAllMocks();
    llm = new GoogleGeminiLanguageModel({
      modelName: "gemini-2.5-flash",
      baseURL: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "test-google-api-key",
      temperature: 0,
    });
  });

  describe("1 – Correct endpoint construction", () => {
    it("calls /models/{model}:generateContent on the configured base URL", async () => {
      mockFetch.mockReturnValue(makeGoodGeminiResponse("Hello from Gemini"));
      await llm.invoke("Hi");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
        expect.any(Object)
      );
    });

    it("encodes model names containing slashes or special characters correctly", async () => {
      const customLlm = new GoogleGeminiLanguageModel({
        modelName: "models/gemini-pro",
        baseURL: "https://generativelanguage.googleapis.com/v1beta",
        apiKey: "test-key",
      });

      mockFetch.mockReturnValue(makeGoodGeminiResponse("Hello"));
      await customLlm.invoke("Hi");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://generativelanguage.googleapis.com/v1beta/models/models%2Fgemini-pro:generateContent",
        expect.any(Object)
      );
    });
  });

  describe("2 – Header authentication & security", () => {
    it("sends x-goog-api-key header with the API key", async () => {
      mockFetch.mockReturnValue(makeGoodGeminiResponse("Response"));
      await llm.invoke("Test");

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers["x-goog-api-key"]).toBe("test-google-api-key");
      expect(opts.headers["Content-Type"]).toBe("application/json");
    });
  });

  describe("3 – Model selection", () => {
    it("respects the configured modelName option", async () => {
      const customLlm = new GoogleGeminiLanguageModel({
        modelName: "gemini-2.5-pro",
        apiKey: "key",
      });

      mockFetch.mockReturnValue(makeGoodGeminiResponse("Pro response"));
      await customLlm.invoke("Test");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("gemini-2.5-pro"),
        expect.any(Object)
      );
    });
  });

  describe("4 – Conversion of normalized messages to Gemini format", () => {
    it("maps a plain string prompt to user contents", async () => {
      mockFetch.mockReturnValue(makeGoodGeminiResponse("Answer"));
      await llm.invoke("Explain Egyptian labor law notice period");

      const [, opts] = mockFetch.mock.calls[0];
      const body = JSON.parse(opts.body);

      expect(body.contents).toEqual([
        {
          role: "user",
          parts: [{ text: "Explain Egyptian labor law notice period" }],
        },
      ]);
      expect(body.systemInstruction).toBeUndefined();
    });

    it("converts multi-turn messages preserving user/model roles and systemInstruction", async () => {
      mockFetch.mockReturnValue(makeGoodGeminiResponse("Sure"));

      await llm.invoke([
        { role: "system", content: "You are Wakeel AI legal assistant." },
        { role: "user", content: "What is annual leave?" },
        { role: "assistant", content: "Annual leave is 21 days." },
        { role: "user", content: "What about after 10 years?" },
      ]);

      const [, opts] = mockFetch.mock.calls[0];
      const body = JSON.parse(opts.body);

      expect(body.systemInstruction).toEqual({
        parts: [{ text: "You are Wakeel AI legal assistant." }],
      });
      expect(body.contents).toEqual([
        { role: "user", parts: [{ text: "What is annual leave?" }] },
        { role: "model", parts: [{ text: "Annual leave is 21 days." }] },
        { role: "user", parts: [{ text: "What about after 10 years?" }] },
      ]);
    });
  });

  describe("5 – Text extraction and usage metadata", () => {
    it("extracts generated text into AIMessage", async () => {
      mockFetch.mockReturnValue(
        makeGoodGeminiResponse("Labor law article 69 provides...")
      );

      const response = await llm.invoke("Query");
      expect(response.content).toBe("Labor law article 69 provides...");
    });

    it("attaches usageMetadata when present in Gemini response", async () => {
      mockFetch.mockReturnValue(
        makeGoodGeminiResponse("Text", {
          promptTokenCount: 15,
          candidatesTokenCount: 30,
          totalTokenCount: 45,
        })
      );

      const response = await llm.invoke("Query");
      expect(response.response_metadata?.usage).toEqual({
        promptTokenCount: 15,
        candidatesTokenCount: 30,
        totalTokenCount: 45,
      });
    });
  });

  describe("6 – Structured output mode (withStructuredOutput)", () => {
    const TestSchema = z.object({
      intent: z.string(),
      confidence: z.number(),
      reasons: z.array(z.string()),
    });

    it("injects schema into systemInstruction and parses valid JSON", async () => {
      const structuredLlm = llm.withStructuredOutput(TestSchema);

      mockFetch.mockReturnValue(
        makeGoodGeminiResponse(
          JSON.stringify({
            intent: "labor_law_query",
            confidence: 0.98,
            reasons: ["Article mentioned"],
          })
        )
      );

      const result = await structuredLlm.invoke("What does article 69 say?");

      expect(result).toEqual({
        intent: "labor_law_query",
        confidence: 0.98,
        reasons: ["Article mentioned"],
      });

      const [, opts] = mockFetch.mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.systemInstruction.parts[0].text).toContain("CRITICAL INSTRUCTION: Return ONLY valid JSON");
    });

    it("strips markdown json fences from Gemini response", async () => {
      const structuredLlm = llm.withStructuredOutput(TestSchema);

      mockFetch.mockReturnValue(
        makeGoodGeminiResponse(
          "```json\n" +
            JSON.stringify({
              intent: "company_policy",
              confidence: 0.95,
              reasons: ["Handbook rule"],
            }) +
            "\n```"
        )
      );

      const result = await structuredLlm.invoke("Query");
      expect(result.intent).toBe("company_policy");
    });

    it("throws a clean error when Gemini returns invalid JSON in structured mode", async () => {
      const structuredLlm = llm.withStructuredOutput(TestSchema);
      mockFetch.mockReturnValue(makeGoodGeminiResponse("Not a JSON string"));

      await expect(structuredLlm.invoke("Query")).rejects.toThrow(
        "Google Gemini returned invalid JSON"
      );
    });
  });

  describe("7 – Error handling & retry behavior", () => {
    it("handles 413 Payload Too Large immediately without retry", async () => {
      mockFetch.mockReturnValue(
        makeErrorResponse(413, "Request payload size exceeds the limit")
      );

      await expect(llm.invoke("Big prompt")).rejects.toMatchObject({
        code: "PAYLOAD_TOO_LARGE",
        status: 413,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("handles non-retryable 401 Unauthorized immediately", async () => {
      mockFetch.mockReturnValue(makeErrorResponse(401, "API key not valid"));

      await expect(llm.invoke("Hi")).rejects.toMatchObject({
        code: "LLM_PROVIDER_ERROR",
        status: 401,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("retries on retryable 500 error and succeeds on subsequent attempt", async () => {
      mockFetch
        .mockReturnValueOnce(makeErrorResponse(500, "Internal error"))
        .mockReturnValueOnce(makeGoodGeminiResponse("Recovered response"));

      const response = await llm.invoke("Hi");
      expect(response.content).toBe("Recovered response");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
