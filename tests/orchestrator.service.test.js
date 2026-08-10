import { jest } from "@jest/globals";

// Mock environment config to prevent process.exit on missing env vars during testing
jest.unstable_mockModule("../src/config/env.js", () => ({
  config: {
    LLM_API_KEY: "test-key",
    LLM_MODEL: "test-model"
  }
}));

// Mock @langchain/openai
const mockInvoke = jest.fn();
jest.unstable_mockModule("@langchain/openai", () => ({
  ChatOpenAI: jest.fn().mockImplementation(() => ({
    withStructuredOutput: jest.fn().mockReturnValue({
      invoke: mockInvoke
    }),
    invoke: mockInvoke
  }))
}));

const { handleChat } = await import("../src/orchestrator/orchestrator.service.js");

describe("Orchestrator Service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const baseInput = {
    message: "I need to calculate my leave balance.",
    conversationId: "conv-1",
    context: {
      userId: "u1",
      companyId: "c1",
      role: "employee"
    }
  };

  it("should process a request, determine intent, and return a final response", async () => {
    // 1st invoke: intent determination
    mockInvoke.mockResolvedValueOnce({
      intent: "leave_request",
      requiresCapabilities: ["leave_request_tool"],
      requiresContext: ["employee"]
    });
    // 2nd invoke: final response
    mockInvoke.mockResolvedValueOnce({
      content: "Your leave balance is 10 days."
    });

    const result = await handleChat(baseInput);

    expect(result.conversationId).toBe("conv-1");
    expect(result.type).toBe("text");
    expect(result.message).toBe("Your leave balance is 10 days.");
    
    // Ensure LLM was called twice
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("should handle LLM fallback on intent failure", async () => {
    // 1st invoke fails
    mockInvoke.mockRejectedValueOnce(new Error("LLM failure"));
    // 2nd invoke succeeds for final response
    mockInvoke.mockResolvedValueOnce({
      content: "General conversation fallback response."
    });

    const result = await handleChat(baseInput);

    expect(result.message).toBe("General conversation fallback response.");
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("should handle fatal orchestration errors cleanly", async () => {
    // We mock the first invoke to throw, but we want to simulate a failure outside the try/catch of determineIntent
    // Actually, determineIntent catches its errors. To simulate a fatal error, we can make the second invoke throw.
    mockInvoke.mockResolvedValueOnce({
        intent: "general_conversation",
        requiresCapabilities: [],
        requiresContext: []
    });
    mockInvoke.mockRejectedValueOnce(new Error("Fatal LLM failure during final response"));

    const result = await handleChat(baseInput);

    expect(result.message).toBe("An internal error occurred while processing your request.");
  });
});
