import { jest } from "@jest/globals";

// ── Mock fetch globally ──────────────────────────────────────────────────────
const mockFetch = jest.fn();
global.fetch = mockFetch;

// ── Mock config so we don't need real env vars ───────────────────────────────
jest.unstable_mockModule("../src/config/env.js", () => ({
  config: {
    LLM_API_KEY: "test-api-key",
    LLM_MODEL: "openai.gpt-oss-120b-1:0",
    LLM_BASE_URL: "http://apiaccess.iti.net.eg/api/v1",
  },
  llmConfig: {
    modelName: "openai.gpt-oss-120b-1:0",
    apiKey: "test-api-key",
    baseURL: undefined,
  },
}));

const { ITILanguageModel } = await import("../src/llm/iti-adapter.js");
const { z } = await import("zod");

const makeGoodResponse = (outputText) =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      output_text: outputText,
      model_id: "openai.gpt-oss-120b-1:0",
      status: "active",
    }),
  });

const makeErrorResponse = (status, body = "") =>
  Promise.resolve({
    ok: false,
    status,
    text: () => Promise.resolve(body),
  });

describe("ITILanguageModel", () => {
  let llm;

  beforeEach(() => {
    jest.clearAllMocks();
    llm = new ITILanguageModel({
      modelName: "openai.gpt-oss-120b-1:0",
      baseURL: "http://apiaccess.iti.net.eg/api/v1",
      apiKey: "test-api-key",
      temperature: 0,
    });
  });

  describe("1 – Correct endpoint path", () => {
    it("calls /student/chat, not /chat/completions", async () => {
      mockFetch.mockReturnValue(makeGoodResponse("Hello"));
      await llm.invoke("hi");
      expect(mockFetch).toHaveBeenCalledWith(
        "http://apiaccess.iti.net.eg/api/v1/student/chat",
        expect.any(Object)
      );
    });
  });

  describe("2 – Authorization header", () => {
    it("sends Authorization: Bearer <key> without exposing it in assertions", async () => {
      mockFetch.mockReturnValue(makeGoodResponse("ok"));
      await llm.invoke("test");
      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers["Authorization"]).toMatch(/^Bearer .+/);
    });
  });

  describe("3 – Correct model_id", () => {
    it("sends model_id matching the configured model", async () => {
      mockFetch.mockReturnValue(makeGoodResponse("ok"));
      await llm.invoke("test");
      const [, opts] = mockFetch.mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.model_id).toBe("openai.gpt-oss-120b-1:0");
    });
  });

  describe("4 – Messages mapping", () => {
    it("maps plain string to messages[0].content", async () => {
      mockFetch.mockReturnValue(makeGoodResponse("ok"));
      await llm.invoke("What is the notice period?");
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages).toEqual([{ role: "user", content: "What is the notice period?" }]);
    });

    it("preserves user and assistant chat history when prompt is a message array", async () => {
      mockFetch.mockReturnValue(makeGoodResponse("ok"));

      await llm.invoke([
        { role: "system", content: "You are Wakeel AI." },
        { role: "user", content: "What are the annual leave rules under Egyptian Labor Law?" },
        { role: "assistant", content: "Annual leave under Egyptian Labor Law includes paid leave rules." },
        { role: "user", content: "summarize it and write the response in arabic" },
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.system_prompt).toBe("You are Wakeel AI.");
      expect(body.messages).toEqual([
        { role: "user", content: "What are the annual leave rules under Egyptian Labor Law?" },
        { role: "assistant", content: "Annual leave under Egyptian Labor Law includes paid leave rules." },
        { role: "user", content: "summarize it and write the response in arabic" },
      ]);
    });
  });

  describe("5 – system_prompt mapping", () => {
    it("sends a system_prompt field", async () => {
      mockFetch.mockReturnValue(makeGoodResponse("ok"));
      await llm.invoke("test");
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toHaveProperty("system_prompt");
      expect(typeof body.system_prompt).toBe("string");
    });
  });

  describe("6 – Successful response parsing", () => {
    it("returns AIMessage with the model text in plain-text mode", async () => {
      mockFetch.mockReturnValue(makeGoodResponse("WAKEEL_LLM_OK"));
      const result = await llm.invoke("reply");
      expect(result.content).toBe("WAKEEL_LLM_OK");
    });
  });

  describe("7 – API error handling", () => {
    it("throws on 401 Unauthorized", async () => {
      mockFetch.mockReturnValue(makeErrorResponse(401, "Unauthorized"));
      await expect(llm.invoke("test")).rejects.toThrow("401");
    });

    it("throws on 500 server error", async () => {
      mockFetch.mockReturnValue(makeErrorResponse(500, "Internal Server Error"));
      await expect(llm.invoke("test")).rejects.toThrow("500");
    });
  });

  describe("8 – Missing API key configuration", () => {
    it("still builds a request (validation is env-level)", async () => {
      const bareModel = new ITILanguageModel({
        modelName: "openai.gpt-oss-120b-1:0",
        baseURL: "http://apiaccess.iti.net.eg/api/v1",
        apiKey: "",
      });
      mockFetch.mockReturnValue(makeGoodResponse("ok"));
      await bareModel.invoke("test");
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model_id).toBe("openai.gpt-oss-120b-1:0");
    });
  });

  describe("9 – Missing model configuration", () => {
    it("uses fallback from config if no modelName provided", () => {
      // Default construction reads from config mock
      const model = new ITILanguageModel();
      expect(model.modelName).toBe("openai.gpt-oss-120b-1:0");
    });
  });

  describe("10 – Structured output behavior", () => {
    const TestSchema = z.object({
      intent: z.string(),
      confidence: z.number(),
    });

    it("returns a parsed JS object (not an AIMessage) in structured mode", async () => {
      mockFetch.mockReturnValue(
        makeGoodResponse(JSON.stringify({ intent: "labor_law", confidence: 0.95 }))
      );
      const structured = llm.withStructuredOutput(TestSchema);
      const result = await structured.invoke("classify this");
      expect(result).toEqual({ intent: "labor_law", confidence: 0.95 });
    });

    it("injects JSON Schema into the system_prompt in structured mode", async () => {
      mockFetch.mockReturnValue(
        makeGoodResponse(JSON.stringify({ intent: "test", confidence: 1 }))
      );
      const structured = llm.withStructuredOutput(TestSchema);
      await structured.invoke("classify this");
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.system_prompt).toContain("JSON Schema");
    });

    it("preserves chat history messages in structured mode", async () => {
      mockFetch.mockReturnValue(
        makeGoodResponse(JSON.stringify({ intent: "general_conversation", confidence: 1 }))
      );
      const structured = llm.withStructuredOutput(TestSchema);

      await structured.invoke([
        { role: "system", content: "Classify the current message." },
        { role: "user", content: "What are the annual leave rules under Egyptian Labor Law?" },
        { role: "assistant", content: "Annual leave answer to summarize." },
        { role: "user", content: "translate that to Arabic" },
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.system_prompt).toContain("Classify the current message.");
      expect(body.system_prompt).toContain("JSON Schema");
      expect(body.messages).toEqual([
        { role: "user", content: "What are the annual leave rules under Egyptian Labor Law?" },
        { role: "assistant", content: "Annual leave answer to summarize." },
        { role: "user", content: "translate that to Arabic" },
      ]);
    });

    it("strips markdown fences before parsing JSON", async () => {
      mockFetch.mockReturnValue(
        makeGoodResponse("```json\n{\"intent\":\"calculation\",\"confidence\":0.8}\n```")
      );
      const structured = llm.withStructuredOutput(TestSchema);
      const result = await structured.invoke("classify this");
      expect(result.intent).toBe("calculation");
    });

    it("throws if the model returns invalid JSON in structured mode", async () => {
      mockFetch.mockReturnValue(makeGoodResponse("This is not JSON at all."));
      const structured = llm.withStructuredOutput(TestSchema);
      await expect(structured.invoke("classify this")).rejects.toThrow("invalid JSON");
    });
  });
});
