import { jest } from "@jest/globals";

// Mock environment config to prevent process.exit on missing env vars during testing
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

const mockGenerateDocument = jest.fn();
jest.unstable_mockModule("../src/services/document-generation.service.js", () => ({
  generateDocument: mockGenerateDocument
}));

const mockHandleCreateLeaveDraft = jest.fn();
const mockHandleSubmitLeaveDraft = jest.fn();
const mockHandleCancelLeaveDraft = jest.fn();
jest.unstable_mockModule("../src/services/leave-request.service.js", () => ({
  handleCreateLeaveDraft: mockHandleCreateLeaveDraft,
  handleSubmitLeaveDraft: mockHandleSubmitLeaveDraft,
  handleCancelLeaveDraft: mockHandleCancelLeaveDraft,
}));

const { handleChat } = await import("../src/orchestrator/orchestrator.service.js");

describe("Orchestrator Service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateDocument.mockReset();
    mockHandleCreateLeaveDraft.mockReset();
    mockHandleSubmitLeaveDraft.mockReset();
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

  it("should route legacy leave_request_tool capability to the leave_request tool", async () => {
    // 1st invoke: intent determination
    mockInvoke.mockResolvedValueOnce({
      intent: "leave_request",
      requiresCapabilities: ["leave_request_tool"],
      requiresContext: ["employee"]
    });
    mockHandleCreateLeaveDraft.mockResolvedValueOnce({
      success: true,
      status: "draft_created",
      message: "I've created your annual leave draft.",
      sources: []
    });

    const result = await handleChat(baseInput);

    expect(result.conversationId).toBe("conv-1");
    expect(result.type).toBe("text");
    expect(result.message).toBe("I've created your annual leave draft.");
    expect(result.actions).toEqual([]);
    expect(mockHandleCreateLeaveDraft).toHaveBeenCalledWith(baseInput.context, {});
    expect(mockInvoke).toHaveBeenCalledTimes(1);
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

  it("should return leave_draft result card directly after leave draft creation", async () => {
    const resultCard = {
      type: "leave_draft",
      request_id: "req-1",
      leave_type: "Annual",
      start_date: "2030-08-10",
      end_date: "2030-08-12",
      days_requested: 3,
      attachment_uploaded: false,
      actions: []
    };

    mockInvoke.mockResolvedValueOnce({
      intent: "create_leave_draft",
      requiresCapabilities: ["create_leave_draft"],
      requiresContext: [],
      arguments: {
        leave_type: "Annual",
        start_date: "2030-08-10",
        end_date: "2030-08-12"
      }
    });
    // The tool wraps service result: data.type === "leave_request", data.result_card, etc.
    mockHandleCreateLeaveDraft.mockResolvedValueOnce({
      success: true,
      status: "draft_created",
      message: "I've created your annual leave draft.",
      sources: [],
      result_card: resultCard,
      action: {
        type: "leave_request",
        payload: {
          request_id: "req-1",
          status: "Draft"
        }
      },
      leave_request: { request_id: "req-1", status: "Draft" }
    });

    const result = await handleChat({
      ...baseInput,
      message: "Create annual leave from 2030-08-10 to 2030-08-12."
    });

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      conversationId: "conv-1",
      message: "I've created your annual leave draft.",
      type: "action",
      sources: [],
      actions: [{
        type: "leave_request",
        payload: {
          request_id: "req-1",
          status: "Draft"
        }
      }],
      result_card: resultCard
    });
  });

  it("should include previous conversation turns when answering a follow-up", async () => {
    const previousAssistantAnswer = "**Annual Leave under the Egyptian Labor Law**\n\n| Item | Rule |\n| --- | --- |\n| Minimum entitlement | 21 days |";

    mockInvoke.mockResolvedValueOnce({
      intent: "general_conversation",
      requiresCapabilities: [],
      requiresContext: []
    });
    mockInvoke.mockResolvedValueOnce({
      content: "ملخص قواعد الإجازة السنوية: يستحق العامل إجازة سنوية مدفوعة بحسب مدة خدمته."
    });

    const result = await handleChat({
      ...baseInput,
      message: "summarize it and write the response in arabic",
      conversationMessages: [
        {
          role: "user",
          content: "What are the annual leave rules under Egyptian Labor Law?"
        },
        {
          role: "assistant",
          content: previousAssistantAnswer
        }
      ]
    });

    expect(result.message).toContain("ملخص");
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockInvoke.mock.calls[0][0]).toContainEqual({
      role: "assistant",
      content: previousAssistantAnswer
    });
    expect(mockInvoke.mock.calls[0][0]).toContainEqual({
      role: "user",
      content: "summarize it and write the response in arabic"
    });
    expect(mockInvoke.mock.calls[1][0]).toContainEqual({
      role: "assistant",
      content: previousAssistantAnswer
    });
    expect(mockInvoke.mock.calls[1][0]).toContainEqual({
      role: "user",
      content: "summarize it and write the response in arabic"
    });
    expect(mockInvoke.mock.calls[1][0][0].content).toContain("Do not claim there is no text to summarize");
  });
});
