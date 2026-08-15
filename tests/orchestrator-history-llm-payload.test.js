import { jest } from "@jest/globals";

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.unstable_mockModule("../src/config/env.js", () => ({
  config: {
    LLM_API_KEY: "test-key",
    LLM_MODEL: "test-model",
    LLM_BASE_URL: "http://localhost",
    WAKEEL_API_BASE_URL: "http://wakeel.local",
    WAKEEL_INTERNAL_API_KEY: "internal-test-key",
    KNOWLEDGE_RETRIEVAL_TOP_K: 5,
  },
  llmConfig: {
    modelName: "test-model",
    apiKey: "test-key",
    baseURL: "http://localhost",
  }
}));

jest.unstable_mockModule("../src/services/document-generation.service.js", () => ({
  generateDocument: jest.fn(),
}));

jest.unstable_mockModule("../src/services/leave-request.service.js", () => ({
  handleCreateLeaveDraft: jest.fn(),
  handleSubmitLeaveDraft: jest.fn(),
  handleCancelLeaveDraft: jest.fn(),
}));

const { handleChat } = await import("../src/orchestrator/orchestrator.service.js");

const previousUserMessage = "What are the annual leave rules under Egyptian Labor Law?";
const previousAssistantResponse = `**Annual Leave under the Egyptian Labor Law**

| Item | What the law says | Practical notes |
|------|-------------------|-----------------|
| Minimum entitlement | Annual paid leave is available under Egyptian Labor Law. | Entitlement depends on service period and employee category. |`;

const baseInput = {
  conversationId: "C1",
  context: {
    userId: "user-1",
    companyId: "company-1",
    role: "employee",
    conversationId: "C1",
  },
  conversationMessages: [
    { role: "user", content: previousUserMessage },
    { role: "assistant", content: previousAssistantResponse },
  ],
};

const makeGatewayResponse = (outputText) => Promise.resolve({
  ok: true,
  json: () => Promise.resolve({
    output_text: outputText,
    model_id: "test-model",
    status: "active",
  }),
});

function parseFetchPayload(callIndex) {
  return JSON.parse(mockFetch.mock.calls[callIndex][1].body);
}

describe("orchestrator history to LLM payload", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch
      .mockReturnValueOnce(makeGatewayResponse(JSON.stringify({
        intent: "general_conversation",
        requiresCapabilities: [],
        requiresContext: [],
      })))
      .mockReturnValueOnce(makeGatewayResponse("ملخص الإجازة السنوية باللغة العربية."));
  });

  it("sends previous user, previous assistant, and current user messages to intent and final LLM calls", async () => {
    const currentUserMessage = "summarize it and write the response in arabic";

    const result = await handleChat({
      ...baseInput,
      message: currentUserMessage,
    });

    expect(result.message).toBe("ملخص الإجازة السنوية باللغة العربية.");
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const intentPayload = parseFetchPayload(0);
    expect(intentPayload.messages).toEqual([
      { role: "user", content: previousUserMessage },
      { role: "assistant", content: previousAssistantResponse },
      { role: "user", content: currentUserMessage },
    ]);
    expect(intentPayload.system_prompt).toContain("JSON Schema");
    expect(intentPayload.system_prompt).toContain("prior conversation messages");

    const finalPayload = parseFetchPayload(1);
    expect(finalPayload.messages).toEqual([
      { role: "user", content: previousUserMessage },
      { role: "assistant", content: previousAssistantResponse },
      { role: "user", content: currentUserMessage },
    ]);
    expect(finalPayload.system_prompt).toContain("Do not claim there is no text to summarize");
  });

  it.each([
    "summarize it and write the response in arabic",
    "what about the notice period?",
    "make your previous answer shorter",
    "translate that to Arabic",
  ])("keeps the previous assistant response in the final LLM payload for contextual follow-up: %s", async (message) => {
    await handleChat({
      ...baseInput,
      message,
    });

    const finalPayload = parseFetchPayload(1);
    expect(finalPayload.messages).toContainEqual({
      role: "assistant",
      content: previousAssistantResponse,
    });
    expect(finalPayload.messages).toContainEqual({
      role: "user",
      content: message,
    });
  });
});
