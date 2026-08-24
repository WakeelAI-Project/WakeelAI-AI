import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { GroqLanguageModel } from "../src/llm/groq-adapter.js";
import { ITILanguageModel } from "../src/llm/iti-adapter.js";

describe("LLM Rate Limiting and Resilience", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("GroqLanguageModel", () => {
    it("should retry on 429 and succeed on subsequent attempt", async () => {
      let callCount = 0;
      global.fetch = jest.fn(async () => {
        callCount += 1;
        if (callCount === 1) {
          return {
            ok: false,
            status: 429,
            headers: new Headers({ "retry-after": "0.01" }),
            text: async () => JSON.stringify({ error: { message: "rate limit exceeded" } }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: "Success response after retry" } }],
          }),
        };
      });

      const model = new GroqLanguageModel({ apiKey: "test", baseURL: "https://api.groq.com/openai/v1" });
      const result = await model.invoke("Hello");

      expect(callCount).toBe(2);
      expect(result.content).toBe("Success response after retry");
    });

    it("should throw RATE_LIMIT_EXCEEDED when 429 retries are exhausted", async () => {
      global.fetch = jest.fn(async () => ({
        ok: false,
        status: 429,
        headers: new Headers({ "retry-after": "0.01" }),
        text: async () => JSON.stringify({ error: { message: "rate limit exceeded" } }),
      }));

      const model = new GroqLanguageModel({ apiKey: "test", baseURL: "https://api.groq.com/openai/v1" });
      await expect(model.invoke("Hello")).rejects.toThrow();
    });

    it("should immediately throw PAYLOAD_TOO_LARGE on 413 without retrying", async () => {
      let callCount = 0;
      global.fetch = jest.fn(async () => {
        callCount += 1;
        return {
          ok: false,
          status: 413,
          text: async () => "Payload Too Large",
        };
      });

      const model = new GroqLanguageModel({ apiKey: "test", baseURL: "https://api.groq.com/openai/v1" });
      await expect(model.invoke("Oversized prompt")).rejects.toThrow("Payload Too Large");
      expect(callCount).toBe(1);
    });
  });

  describe("ITILanguageModel", () => {
    it("should retry on 429 and succeed on subsequent attempt", async () => {
      let callCount = 0;
      global.fetch = jest.fn(async () => {
        callCount += 1;
        if (callCount === 1) {
          return {
            ok: false,
            status: 429,
            headers: new Headers({ "retry-after": "0.01" }),
            text: async () => JSON.stringify({ error: "rate_limit_exceeded" }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            output_text: "ITI Success response after retry",
          }),
        };
      });

      const model = new ITILanguageModel({ apiKey: "test", baseURL: "https://iti.test" });
      const result = await model.invoke("Hello");

      expect(callCount).toBe(2);
      expect(result.content).toBe("ITI Success response after retry");
    });
  });
});
