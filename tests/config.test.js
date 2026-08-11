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
