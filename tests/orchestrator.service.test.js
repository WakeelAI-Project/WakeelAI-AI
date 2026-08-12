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

const mockGenerateDocument = jest.fn();
jest.unstable_mockModule("../src/services/document-generation.service.js", () => ({
  generateDocument: mockGenerateDocument
}));

const { handleChat } = await import("../src/orchestrator/orchestrator.service.js");

describe("Orchestrator Service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateDocument.mockReset();
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

  it("should return structured missing fields directly for document generation", async () => {
    const missingFields = [{
      field_name: "employee_id",
      input_type: "text",
      label: "Employee ID",
      options: []
    }];

    mockInvoke.mockResolvedValueOnce({
      intent: "document_generation",
      requiresCapabilities: [],
      requiresContext: []
    });
    mockGenerateDocument.mockResolvedValueOnce({
      success: true,
      status: "missing_fields",
      message: "I can create that draft, but I need a few required fields first.",
      missing_fields: missingFields,
      sources: []
    });

    const result = await handleChat({
      ...baseInput,
      message: "Create an employment contract for Ahmed"
    });

    expect(mockGenerateDocument).toHaveBeenCalledWith({
      message: "Create an employment contract for Ahmed",
      aiContext: baseInput.context
    });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      conversationId: "conv-1",
      message: "I can create that draft, but I need a few required fields first.",
      type: "text",
      sources: [],
      actions: [],
      missing_fields: missingFields
    });
  });

  it("should return document_draft result card directly after document save", async () => {
    const resultCard = {
      type: "document_draft",
      doc_id: "doc-1",
      doc_type: "Contract",
      employee_id: "emp-1",
      employee_name: "Ahmed"
    };

    mockInvoke.mockResolvedValueOnce({
      intent: "document_generation",
      requiresCapabilities: ["document_generation"],
      requiresContext: []
    });
    mockGenerateDocument.mockResolvedValueOnce({
      success: true,
      status: "saved",
      message: "I've created and saved Employment Contract - Ahmed as a draft.",
      sources: [],
      result_card: resultCard
    });

    const result = await handleChat({
      ...baseInput,
      message: "Create an employment contract for Ahmed"
    });

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      conversationId: "conv-1",
      message: "I've created and saved Employment Contract - Ahmed as a draft.",
      type: "action",
      sources: [],
      actions: [],
      result_card: resultCard
    });
  });
});
