import { jest } from "@jest/globals";

// FIX-22: for each of the 11 possible intents, prove the orchestrator dispatches
// to the expected downstream boundary (context gatherer / capability executor) for
// both an English and an Arabic representative message. The LLM adapter is mocked
// throughout - this never hits a live model - so what's actually under test is the
// orchestrator's *routing* given a classified intent, not the classification itself.

jest.unstable_mockModule("../src/config/env.js", () => ({
  config: {
    LLM_API_KEY: "test-key",
    LLM_MODEL: "test-model",
    LLM_BASE_URL: "http://localhost",
  },
  llmConfig: {
    modelName: "test-model",
    apiKey: "test-key",
  },
}));

const mockInvoke = jest.fn();
jest.unstable_mockModule("../src/llm/iti-adapter.js", () => ({
  ITILanguageModel: jest.fn().mockImplementation(() => ({
    withStructuredOutput: jest.fn().mockReturnValue({ invoke: mockInvoke }),
    invoke: mockInvoke,
  })),
}));

const mockGatherContextBoundary = jest.fn().mockResolvedValue({});
const mockExecuteCapabilitiesBoundary = jest.fn().mockResolvedValue([]);
jest.unstable_mockModule("../src/orchestrator/dependency-boundaries.js", () => ({
  gatherContextBoundary: mockGatherContextBoundary,
  executeCapabilitiesBoundary: mockExecuteCapabilitiesBoundary,
}));

const { handleChat } = await import("../src/orchestrator/orchestrator.service.js");

const baseContext = { userId: "u1", companyId: "c1", role: "Employee" };

function mockIntent(intent) {
  mockInvoke.mockResolvedValueOnce(intent);
}

function mockFinalAnswer(content = "Final answer.") {
  mockInvoke.mockResolvedValueOnce({ content });
}

describe("Orchestrator intent routing (FIX-22)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGatherContextBoundary.mockResolvedValue({});
    mockExecuteCapabilitiesBoundary.mockResolvedValue([]);
  });

  const capabilityDispatchCases = [
    {
      name: "calculation",
      intent: { intent: "calculation", requiresCapabilities: ["calculation"], requiresContext: [] },
      expectedCapability: "calculation",
      en: "How much end-of-service gratuity am I owed after 8 years?",
      ar: "كم مكافأة نهاية الخدمة المستحقة لي بعد 8 سنوات؟",
    },
    {
      name: "company_policy_question",
      intent: { intent: "company_policy_question", requiresCapabilities: [], requiresContext: ["rag"] },
      expectedCapability: "company_policy",
      en: "What does our company policy say about remote work?",
      ar: "ماذا تقول سياسة شركتنا عن العمل عن بعد؟",
    },
    {
      name: "labor_law_question",
      intent: { intent: "labor_law_question", requiresCapabilities: [], requiresContext: ["rag"] },
      expectedCapability: "labor_law",
      en: "What does Egyptian labor law say about annual leave?",
      ar: "ماذا يقول قانون العمل المصري عن الإجازة السنوية؟",
    },
  ];

  it.each(capabilityDispatchCases)(
    "$name (EN) deterministically dispatches the $expectedCapability capability",
    async ({ intent, expectedCapability, en }) => {
      mockIntent(intent);
      mockFinalAnswer();

      const result = await handleChat({
        message: en,
        conversationId: "conv-1",
        context: baseContext,
      });

      expect(mockExecuteCapabilitiesBoundary).toHaveBeenCalledWith(
        expect.arrayContaining([expectedCapability]),
        expect.anything(),
      );
      expect(result.type).toBe("text");
      expect(result.conversationId).toBe("conv-1");
    },
  );

  it.each(capabilityDispatchCases)(
    "$name (AR) deterministically dispatches the $expectedCapability capability",
    async ({ intent, expectedCapability, ar }) => {
      mockIntent(intent);
      mockFinalAnswer();

      const result = await handleChat({
        message: ar,
        conversationId: "conv-1",
        context: baseContext,
      });

      expect(mockExecuteCapabilitiesBoundary).toHaveBeenCalledWith(
        expect.arrayContaining([expectedCapability]),
        expect.anything(),
      );
      expect(result.type).toBe("text");
    },
  );

  it("uses field_values.capability=employee_context as a deterministic employee-context hint", async () => {
    mockIntent({ intent: "general_conversation", requiresCapabilities: [], requiresContext: [] });
    mockFinalAnswer("Employee answer.");

    await handleChat({
      message: "Nourhan",
      conversationId: "conv-1",
      context: {
        ...baseContext,
        field_values: { capability: "employee_context" },
      },
    });

    expect(mockGatherContextBoundary).toHaveBeenCalledWith(
      expect.arrayContaining(["employee"]),
      expect.objectContaining({
        field_values: expect.objectContaining({ capability: "employee_context" }),
      }),
    );
    expect(mockExecuteCapabilitiesBoundary).toHaveBeenCalledWith([], expect.anything());
  });

  it("uses field_values.capability=company_policy to route the existing company_policy skill", async () => {
    mockIntent({ intent: "general_conversation", requiresCapabilities: [], requiresContext: [] });
    mockFinalAnswer("Policy answer.");

    await handleChat({
      message: "What about leave?",
      conversationId: "conv-1",
      context: {
        ...baseContext,
        field_values: { capability: "company_policy" },
      },
    });

    expect(mockExecuteCapabilitiesBoundary).toHaveBeenCalledWith(
      expect.arrayContaining(["company_policy"]),
      expect.anything(),
    );
  });

  it("uses document_generation hints and preserves the selected document_type", async () => {
    mockIntent({ intent: "general_conversation", requiresCapabilities: [], requiresContext: [] });
    mockExecuteCapabilitiesBoundary.mockResolvedValueOnce([
      {
        capability: "document_generation",
        status: "success",
        data: {
          message: "Document ready.",
          sources: [],
          data: {
            type: "document_generation",
            status: "missing_fields",
            missing_fields: [],
          },
        },
      },
    ]);

    const result = await handleChat({
      message: "Please prepare it for Nourhan",
      conversationId: "conv-1",
      context: {
        ...baseContext,
        field_values: {
          capability: "document_generation",
          document_type: "Contract",
        },
      },
    });

    expect(mockExecuteCapabilitiesBoundary).toHaveBeenCalledWith(
      expect.arrayContaining(["document_generation"]),
      expect.objectContaining({
        userContext: expect.objectContaining({
          field_values: expect.objectContaining({
            capability: "document_generation",
            document_type: "Contract",
          }),
        }),
      }),
    );
    expect(result.message).toBe("Document ready.");
  });

  const shortCircuitCases = [
    {
      name: "document_generation",
      intent: { intent: "document_generation", requiresCapabilities: [], requiresContext: [] },
      capability: "document_generation",
      resultData: {
        type: "document_generation",
        status: "missing_fields",
        missing_fields: [],
      },
      en: "Generate an employment contract",
      ar: "أنشئ عقد عمل",
    },
    {
      name: "create_leave_draft",
      intent: { intent: "create_leave_draft", requiresCapabilities: [], requiresContext: [] },
      capability: "create_leave_draft",
      resultData: { type: "leave_request", status: "draft_created" },
      en: "I want to request annual leave sometime next month",
      ar: "أريد طلب إجازة سنوية الشهر القادم",
    },
    {
      name: "submit_leave_draft",
      intent: { intent: "submit_leave_draft", requiresCapabilities: [], requiresContext: [] },
      capability: "submit_leave_draft",
      resultData: { type: "leave_request", status: "submitted" },
      en: "Go ahead and submit my draft leave request",
      ar: "من فضلك أرسل مسودة طلب الإجازة الخاصة بي",
    },
    {
      name: "cancel_leave_draft",
      intent: { intent: "cancel_leave_draft", requiresCapabilities: [], requiresContext: [] },
      capability: "cancel_leave_draft",
      resultData: { type: "leave_request", status: "cancelled" },
      en: "Cancel my draft leave request",
      ar: "ألغِ مسودة طلب الإجازة الخاصة بي",
    },
  ];

  it.each(shortCircuitCases)(
    "$name (EN) resolves via the $capability capability without a second LLM call",
    async ({ intent, capability, resultData, en }) => {
      mockIntent(intent);
      mockExecuteCapabilitiesBoundary.mockResolvedValueOnce([
        {
          capability,
          status: "success",
          data: { message: "Done.", sources: [], data: resultData },
        },
      ]);

      const result = await handleChat({
        message: en,
        conversationId: "conv-1",
        context: baseContext,
      });

      expect(mockExecuteCapabilitiesBoundary).toHaveBeenCalledWith(
        expect.arrayContaining([capability]),
        expect.anything(),
      );
      expect(result.message).toBe("Done.");
      expect(mockInvoke).toHaveBeenCalledTimes(1); // intent only - no final synthesis call
    },
  );

  it.each(shortCircuitCases)(
    "$name (AR) resolves via the $capability capability without a second LLM call",
    async ({ intent, capability, resultData, ar }) => {
      mockIntent(intent);
      mockExecuteCapabilitiesBoundary.mockResolvedValueOnce([
        {
          capability,
          status: "success",
          data: { message: "تم.", sources: [], data: resultData },
        },
      ]);

      const result = await handleChat({
        message: ar,
        conversationId: "conv-1",
        context: baseContext,
      });

      expect(result.message).toBe("تم.");
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    },
  );

  const contextOnlyCases = [
    {
      name: "employee_question",
      intent: { intent: "employee_question", requiresCapabilities: [], requiresContext: ["employee"] },
      expectedContext: "employee",
      en: "What is my current job title?",
      ar: "ما هو مسمى وظيفتي الحالي؟",
    },
    {
      name: "company_question",
      intent: { intent: "company_question", requiresCapabilities: [], requiresContext: [] },
      expectedContext: "company",
      en: "What is the name of my company?",
      ar: "ما اسم شركتي؟",
    },
  ];

  it.each(contextOnlyCases)(
    "$name (EN) gathers $expectedContext context and answers via the final LLM call",
    async ({ intent, expectedContext, en }) => {
      mockIntent(intent);
      mockFinalAnswer("Here is your answer.");

      const result = await handleChat({
        message: en,
        conversationId: "conv-1",
        context: baseContext,
      });

      expect(mockGatherContextBoundary).toHaveBeenCalledWith(
        expect.arrayContaining([expectedContext]),
        expect.anything(),
      );
      expect(result.message).toBe("Here is your answer.");
    },
  );

  it.each(contextOnlyCases)(
    "$name (AR) gathers $expectedContext context and answers via the final LLM call",
    async ({ intent, expectedContext, ar }) => {
      mockIntent(intent);
      mockFinalAnswer("إليك إجابتك.");

      const result = await handleChat({
        message: ar,
        conversationId: "conv-1",
        context: baseContext,
      });

      expect(mockGatherContextBoundary).toHaveBeenCalledWith(
        expect.arrayContaining([expectedContext]),
        expect.anything(),
      );
      expect(result.message).toBe("إليك إجابتك.");
    },
  );

  it("general_conversation (EN) answers via the final LLM call with no context or capability calls", async () => {
    mockIntent({ intent: "general_conversation", requiresCapabilities: [], requiresContext: [] });
    mockFinalAnswer("Hello! How can I help with HR today?");

    const result = await handleChat({
      message: "Hi there",
      conversationId: "conv-1",
      context: baseContext,
    });

    expect(mockGatherContextBoundary).toHaveBeenCalledWith([], expect.anything());
    expect(mockExecuteCapabilitiesBoundary).toHaveBeenCalledWith([], expect.anything());
    expect(result.message).toBe("Hello! How can I help with HR today?");
  });

  it("general_conversation (AR) answers via the final LLM call with no context or capability calls", async () => {
    mockIntent({ intent: "general_conversation", requiresCapabilities: [], requiresContext: [] });
    mockFinalAnswer("مرحباً! كيف يمكنني مساعدتك في شؤون الموارد البشرية اليوم؟");

    const result = await handleChat({
      message: "مرحباً",
      conversationId: "conv-1",
      context: baseContext,
    });

    expect(mockGatherContextBoundary).toHaveBeenCalledWith([], expect.anything());
    expect(mockExecuteCapabilitiesBoundary).toHaveBeenCalledWith([], expect.anything());
    expect(result.message).toBe("مرحباً! كيف يمكنني مساعدتك في شؤون الموارد البشرية اليوم؟");
  });

  it("out_of_scope (EN) is refused before any context or capability call is made", async () => {
    mockIntent({ intent: "out_of_scope", requiresCapabilities: [], requiresContext: [] });

    const result = await handleChat({
      message: "What's a good recipe for koshari?",
      conversationId: "conv-1",
      context: baseContext,
    });

    expect(mockGatherContextBoundary).not.toHaveBeenCalled();
    expect(mockExecuteCapabilitiesBoundary).not.toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledTimes(1); // intent only - never a second (final-answer) call
    expect(result.type).toBe("text");
    expect(result.message).toContain("Wakeel AI");
  });

  it("out_of_scope (AR) is refused before any context or capability call is made", async () => {
    mockIntent({ intent: "out_of_scope", requiresCapabilities: [], requiresContext: [] });

    const result = await handleChat({
      message: "ما هي وصفة جيدة للكشري؟",
      conversationId: "conv-1",
      context: baseContext,
    });

    expect(mockGatherContextBoundary).not.toHaveBeenCalled();
    expect(mockExecuteCapabilitiesBoundary).not.toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(result.message).toContain("Wakeel AI");
  });
});
