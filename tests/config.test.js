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

  const validEnv = (overrides = {}) => ({
    NODE_ENV: "production",
    PORT: "8080",
    MONGODB_URI: "mongodb://localhost:27017/test",
    MONGODB_DB_NAME: "test",
    LLM_API_KEY: "sk-test12345",
    LLM_MODEL: "gpt-4",
    HUGGINGFACE_API_KEY: "hf_test_token",
    EMBEDDING_MODEL: "intfloat/multilingual-e5-large",
    WAKEEL_API_BASE_URL: "https://api.wakeel.local",
    WAKEEL_INTERNAL_API_KEY: "internal-secret",
    VECTOR_INDEX_NAME: "test_vector_index",
    KNOWLEDGE_RETRIEVAL_TOP_K: "10",
    KNOWLEDGE_CHUNK_SIZE: "2000",
    INITIAL_LABOR_LAW_DOCUMENT_ID: "labor-law",
    INITIAL_LABOR_LAW_TITLE: "Labor Law",
    INITIAL_LABOR_LAW_VERSION: "v1",
    INITIAL_LABOR_LAW_SOURCE_PATH: "knowledge/labor-law.pdf",
    ...overrides,
  });

  it("should fail when required environment variables are missing", async () => {
    jest.unstable_mockModule("dotenv", () => ({
      default: {
        config: jest.fn()
      }
    }));

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

  it.each([
    ["WAKEEL_INTERNAL_API_KEY"],
    ["MONGODB_URI"],
    ["LLM_API_KEY"],
  ])("fails fast and names %s when that credential is missing", async (key) => {
    jest.unstable_mockModule("dotenv", () => ({
      default: { config: jest.fn() },
    }));

    const env = validEnv();
    delete env[key];
    process.env = env;

    const mockExit = jest.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`Process exited with code ${code}`);
    });
    const mockConsoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(import("../src/config/env.js")).rejects.toThrow(
      "Process exited with code 1",
    );

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining(`${key} is missing or empty`),
    );

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });

  it("fails fast when a required credential is present but blank", async () => {
    jest.unstable_mockModule("dotenv", () => ({
      default: { config: jest.fn() },
    }));

    process.env = validEnv({ LLM_API_KEY: "   " });

    const mockExit = jest.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`Process exited with code ${code}`);
    });
    const mockConsoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(import("../src/config/env.js")).rejects.toThrow(
      "Process exited with code 1",
    );

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining("LLM_API_KEY is missing or empty"),
    );

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });

  it("fails in production when WAKEEL_API_BASE_URL points to localhost", async () => {
    jest.unstable_mockModule("dotenv", () => ({
      default: {
        config: jest.fn()
      }
    }));

    process.env = validEnv({
      WAKEEL_API_BASE_URL: "http://localhost:5000",
    });

    const mockExit = jest.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`Process exited with code ${code}`);
    });
    const mockConsoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(import("../src/config/env.js")).rejects.toThrow("Process exited with code 1");

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining("WAKEEL_API_BASE_URL cannot point to localhost")
    );

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });
});
