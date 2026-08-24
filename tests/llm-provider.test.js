import { jest } from "@jest/globals";

describe("LLM provider selection", () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const validEnv = (overrides = {}) => ({
    NODE_ENV: "test",
    PORT: "3000",
    MONGODB_URI: "mongodb://localhost:27017/test",
    MONGODB_DB_NAME: "test",
    LLM_API_KEY: "test-key",
    LLM_MODEL: "test-model",
    LLM_BASE_URL: "https://api.groq.com/openai/v1",
    HUGGINGFACE_API_KEY: "hf_test_token",
    EMBEDDING_MODEL: "intfloat/multilingual-e5-large",
    WAKEEL_API_BASE_URL: "https://api.wakeel.local",
    WAKEEL_INTERNAL_API_KEY: "internal-secret",
    VECTOR_INDEX_NAME: "test_vector_index",
    KNOWLEDGE_RETRIEVAL_TOP_K: "5",
    KNOWLEDGE_CHUNK_SIZE: "1200",
    INITIAL_LABOR_LAW_DOCUMENT_ID: "labor-law",
    INITIAL_LABOR_LAW_TITLE: "Labor Law",
    INITIAL_LABOR_LAW_VERSION: "v1",
    INITIAL_LABOR_LAW_SOURCE_PATH: "knowledge/labor-law.pdf",
    ...overrides,
  });

  it("defaults to the ITI provider when LLM_PROVIDER is not set", async () => {
    process.env = validEnv();
    const { config } = await import("../src/config/env.js");
    expect(config.LLM_PROVIDER).toBe("iti");
  });

  it("selects the Groq adapter when LLM_PROVIDER=groq", async () => {
    process.env = validEnv({ LLM_PROVIDER: "groq" });
    const { createLLM } = await import("../src/llm/llm-provider.js");
    const llm = createLLM({
      apiKey: process.env.LLM_API_KEY,
      modelName: process.env.LLM_MODEL,
      baseURL: process.env.LLM_BASE_URL,
    });

    expect(llm.constructor.name).toBe("GroqLanguageModel");
    expect(llm.baseURL).toBe("https://api.groq.com/openai/v1");
  });

  it("selects the Google Gemini adapter when LLM_PROVIDER=google", async () => {
    process.env = validEnv({
      LLM_PROVIDER: "google",
      GOOGLE_API_KEY: "google-test-key",
      GOOGLE_MODEL: "gemini-2.5-flash",
    });
    const { createLLM } = await import("../src/llm/llm-provider.js");
    const llm = createLLM();

    expect(llm.constructor.name).toBe("GoogleGeminiLanguageModel");
    expect(llm.apiKey).toBe("google-test-key");
    expect(llm.modelName).toBe("gemini-2.5-flash");
    expect(llm.baseURL).toBe("https://generativelanguage.googleapis.com/v1beta");
  });
});
