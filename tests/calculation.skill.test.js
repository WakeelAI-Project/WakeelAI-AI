import { jest } from "@jest/globals";

// Mock environment config to prevent missing env vars
jest.unstable_mockModule("../src/config/env.js", () => ({
  config: {
    LLM_API_KEY: "test-key",
    LLM_MODEL: "test-model",
    LLM_BASE_URL: "http://localhost",
  },
  llmConfig: {
    modelName: "test-model",
    apiKey: "test-key",
  }
}));

// Mock iti-adapter so tests don't make real HTTP calls
const mockInvoke = jest.fn();
jest.unstable_mockModule("../src/llm/iti-adapter.js", () => ({
  ITILanguageModel: jest.fn().mockImplementation(() => ({
    withStructuredOutput: jest.fn().mockReturnValue({
      invoke: mockInvoke
    }),
    invoke: mockInvoke
  }))
}));

const { default: calculationSkill } = await import("../src/skills/calculation/calculation.skill.js");
const { get, has, clear } = await import("../src/skills/registry.js");
const { executeCapabilitiesBoundary } = await import("../src/orchestrator/dependency-boundaries.js");

describe("CalculationSkill", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Skill Contract & Validation", () => {
    it("should have the correct skill structure", () => {
      expect(calculationSkill.name).toBe("calculation");
      expect(typeof calculationSkill.description).toBe("string");
      expect(calculationSkill.inputSchema).toBeDefined();
      expect(typeof calculationSkill.execute).toBe("function");
    });
  });

  describe("Skill Execution", () => {
    const mockContext = { userId: "u1", companyId: "c1", role: "employee" };

    it("should parse message and return successful calculation", async () => {
      mockInvoke.mockResolvedValueOnce({
        operation: "add",
        operands: [15, 20],
        unit: "days"
      });

      const result = await calculationSkill.execute("Add 15 and 20 days", mockContext);
      
      expect(mockInvoke).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.data.result).toBe(35);
      expect(result.data.unit).toBe("days");
      expect(result.message).toContain("35");
    });

    it("should return failure if calculation fails", async () => {
      mockInvoke.mockResolvedValueOnce({
        operation: "divide",
        operands: [10, 0]
      });

      const result = await calculationSkill.execute("Divide 10 by 0", mockContext);
      
      expect(result.success).toBe(false);
      expect(result.message).toContain("Division by zero");
    });

    it("should handle LLM parsing errors gracefully", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("LLM Error"));

      const result = await calculationSkill.execute("Some random input", mockContext);
      
      expect(result.success).toBe(false);
      expect(result.message).toContain("An error occurred while attempting to parse or execute");
    });
  });

  describe("Integration with Orchestrator Boundary", () => {
    // We want to test that when the orchestrator calls executeCapabilitiesBoundary,
    // the calculation skill is found and executed correctly.
    // Notice that dependency-boundaries.js automatically imports and registers the calculation skill.
    
    it("should be registered in the skill registry", () => {
      expect(has("calculation")).toBe(true);
      const registered = get("calculation");
      expect(registered).toBe(calculationSkill);
    });

    it("should be executed correctly via boundary", async () => {
      mockInvoke.mockResolvedValueOnce({
        operation: "multiply",
        operands: [6, 7]
      });

      const orchContext = {
        message: "What is 6 times 7?",
        userContext: { userId: "u1", companyId: "c1", role: "employee" }
      };

      const results = await executeCapabilitiesBoundary(["calculation"], orchContext);

      expect(results.length).toBe(1);
      expect(results[0].capability).toBe("calculation");
      expect(results[0].status).toBe("success");
      expect(results[0].data.success).toBe(true);
      expect(results[0].data.data.result).toBe(42);
    });
  });
});
