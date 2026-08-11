import { jest } from "@jest/globals";

describe("Configuration Validation", () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should fail when required environment variables are missing", async () => {
    jest.unstable_mockModule("dotenv", () => ({
      default: {
        config: jest.fn()
      }
    }));

    const mockEnv = {
      NODE_ENV: "production",
      PORT: "8080",
      MONGODB_URI: "mongodb://localhost:27017/test",
      MONGODB_DB_NAME: "test",
      LLM_API_KEY: "sk-test12345",
      LLM_MODEL: "gpt-4",
      HUGGINGFACE_API_KEY: "hf_test_token",
      EMBEDDING_MODEL: "intfloat/multilingual-e5-large",
      WAKEEL_API_BASE_URL: "https://api.wakeel.local",
      WAKEEL_INTERNAL_API_KEY: "wakeel-secret",
      INTERNAL_SERVICE_KEY: "internal-secret",
      VECTOR_INDEX_NAME: "test_vector_index",
      KNOWLEDGE_RETRIEVAL_TOP_K: "10",
      KNOWLEDGE_RETRIEVAL_MIN_SCORE: "0.85",
      KNOWLEDGE_CHUNK_SIZE: "2000",
      KNOWLEDGE_CHUNK_OVERLAP: "400",
    };

    process.env = {}; // Clear env

    // Mock process.exit to prevent the test from exiting
    const mockExit = jest.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`Process exited with code ${code}`);
    });

    const mockConsoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(import("../src/config/env.js")).rejects.toThrow("Process exited with code 1");

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockConsoleError).toHaveBeenCalled();

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });
});
