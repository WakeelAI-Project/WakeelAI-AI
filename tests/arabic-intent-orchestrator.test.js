import { jest } from "@jest/globals";

// Mock environment config
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

const mockSearchEmployeesByNameApi = jest.fn();
const mockGetEmployeeContextApi = jest.fn();
jest.unstable_mockModule("../src/integrations/wakeel/employee-api.js", () => ({
  searchEmployeesByNameApi: mockSearchEmployeesByNameApi,
  getEmployeeContextApi: mockGetEmployeeContextApi,
}));

const mockUpsertConversation = jest.fn().mockResolvedValue({});
jest.unstable_mockModule("../src/data-access/chat-history.repository.js", () => ({
  upsertConversation: mockUpsertConversation,
}));

const { handleChat } = await import("../src/orchestrator/orchestrator.service.js");

describe("Arabic & English Orchestrator Side-by-Side Suite", () => {
  const hrContext = {
    userId: "hr-user-1",
    companyId: "company-1",
    role: "HR_Manager",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGatherContextBoundary.mockResolvedValue({});
    mockExecuteCapabilitiesBoundary.mockResolvedValue([]);
  });

  function mockIntent(intent) {
    mockInvoke.mockResolvedValueOnce(intent);
  }

  function mockFinalAnswer(content = "Final response text.") {
    mockInvoke.mockResolvedValueOnce({ content });
  }

  describe("Pair 1 & 2: Employee Information Resolution (Farida & Nourhan)", () => {
    it("resolves Farida in English: 'what do you know about Farida'", async () => {
      mockSearchEmployeesByNameApi.mockResolvedValueOnce({
        employees: [{ employee_id: "emp-farida-123", full_name: "Farida Ahmed" }],
      });
      mockGatherContextBoundary.mockResolvedValueOnce({
        employee: { record_id: "emp-farida-123", full_name: "Farida Ahmed", salary: 12000 },
      });
      mockIntent({
        intent: "general_conversation",
        requiresCapabilities: [],
        requiresContext: [],
      });
      mockFinalAnswer("Farida Ahmed works as a Financial Analyst.");

      const result = await handleChat({
        message: "what do you know about Farida",
        conversationId: "conv-farida-en",
        context: hrContext,
      });

      expect(mockSearchEmployeesByNameApi).toHaveBeenCalledWith(
        expect.objectContaining({ companyId: "company-1" }),
        "Farida",
      );
      expect(mockGatherContextBoundary).toHaveBeenCalledWith(
        expect.arrayContaining(["employee"]),
        expect.objectContaining({ targetEmployeeId: "emp-farida-123" }),
      );
      expect(result.message).toContain("Farida");
    });

    it("resolves Farida in Arabic: 'تعرف ايه عن فريده' (handling Teh Marbuta / Heh spelling variation)", async () => {
      mockSearchEmployeesByNameApi.mockResolvedValueOnce({
        employees: [{ employee_id: "emp-farida-123", full_name: "فريدة أحمد" }],
      });
      mockGatherContextBoundary.mockResolvedValueOnce({
        employee: { record_id: "emp-farida-123", full_name: "فريدة أحمد", salary: 12000 },
      });
      mockIntent({
        intent: "general_conversation",
        requiresCapabilities: [],
        requiresContext: [],
      });
      mockFinalAnswer("فريدة أحمد تعمل في قسم المالية.");

      const result = await handleChat({
        message: "تعرف ايه عن فريده",
        conversationId: "conv-farida-ar",
        context: hrContext,
      });

      expect(mockSearchEmployeesByNameApi).toHaveBeenCalled();
      expect(mockGatherContextBoundary).toHaveBeenCalledWith(
        expect.arrayContaining(["employee"]),
        expect.objectContaining({ targetEmployeeId: "emp-farida-123" }),
      );
      expect(result.message).toContain("فريدة");
    });

    it("resolves Nourhan in English: 'what do you know about Nourhan'", async () => {
      mockSearchEmployeesByNameApi.mockResolvedValueOnce({
        employees: [{ employee_id: "emp-nourhan-456", full_name: "Nourhan Ali" }],
      });
      mockGatherContextBoundary.mockResolvedValueOnce({
        employee: { record_id: "emp-nourhan-456", full_name: "Nourhan Ali", salary: 15000 },
      });
      mockIntent({
        intent: "employee_question",
        requiresCapabilities: [],
        requiresContext: ["employee"],
      });
      mockFinalAnswer("Nourhan Ali is an HR Specialist.");

      const result = await handleChat({
        message: "what do you know about Nourhan",
        conversationId: "conv-nourhan-en",
        context: hrContext,
      });

      expect(mockSearchEmployeesByNameApi).toHaveBeenCalledWith(
        expect.objectContaining({ companyId: "company-1" }),
        "Nourhan",
      );
      expect(mockGatherContextBoundary).toHaveBeenCalledWith(
        expect.arrayContaining(["employee"]),
        expect.objectContaining({ targetEmployeeId: "emp-nourhan-456" }),
      );
      expect(result.message).toContain("Nourhan");
    });

    it("resolves Nourhan in Arabic: 'ماذا تعرف عن نورهان'", async () => {
      mockSearchEmployeesByNameApi.mockResolvedValueOnce({
        employees: [{ employee_id: "emp-nourhan-456", full_name: "نورهان علي" }],
      });
      mockGatherContextBoundary.mockResolvedValueOnce({
        employee: { record_id: "emp-nourhan-456", full_name: "نورهان علي", salary: 15000 },
      });
      mockIntent({
        intent: "general_conversation",
        requiresCapabilities: [],
        requiresContext: [],
      });
      mockFinalAnswer("نورهان علي هي أخصائية موارد بشرية.");

      const result = await handleChat({
        message: "ماذا تعرف عن نورهان",
        conversationId: "conv-nourhan-ar",
        context: hrContext,
      });

      expect(mockSearchEmployeesByNameApi).toHaveBeenCalledWith(
        expect.objectContaining({ companyId: "company-1" }),
        "نورهان",
      );
      expect(mockGatherContextBoundary).toHaveBeenCalledWith(
        expect.arrayContaining(["employee"]),
        expect.objectContaining({ targetEmployeeId: "emp-nourhan-456" }),
      );
      expect(result.message).toContain("نورهان");
    });
  });

  describe("Pair 3 & 4: Contract Creation & Pronoun Reference Resolution", () => {
    it("routes English contract creation for a named employee: 'create a contract for Farida'", async () => {
      mockSearchEmployeesByNameApi.mockResolvedValueOnce({
        employees: [{ employee_id: "emp-farida-123", full_name: "Farida Ahmed" }],
      });
      mockExecuteCapabilitiesBoundary.mockResolvedValueOnce([
        {
          capability: "document_generation",
          status: "success",
          data: {
            data: {
              type: "document_generation",
              status: "missing_fields",
              missing_fields: [],
            },
            message: "Employment contract draft prepared.",
          },
        },
      ]);
      mockIntent({
        intent: "general_conversation",
        requiresCapabilities: [],
        requiresContext: [],
      });

      const result = await handleChat({
        message: "create a contract for Farida",
        conversationId: "conv-contract-en",
        context: hrContext,
      });

      expect(mockExecuteCapabilitiesBoundary).toHaveBeenCalledWith(
        expect.arrayContaining(["document_generation"]),
        expect.objectContaining({
          userContext: expect.objectContaining({ targetEmployeeId: "emp-farida-123" }),
        }),
      );
      expect(result.message).toBe("Employment contract draft prepared.");
    });

    it("routes Arabic contract creation for a named employee: 'اعملي عقد عمل لفريدة'", async () => {
      mockSearchEmployeesByNameApi.mockResolvedValueOnce({
        employees: [{ employee_id: "emp-farida-123", full_name: "فريدة أحمد" }],
      });
      mockExecuteCapabilitiesBoundary.mockResolvedValueOnce([
        {
          capability: "document_generation",
          status: "success",
          data: {
            data: {
              type: "document_generation",
              status: "missing_fields",
              missing_fields: [],
            },
            message: "تم تجهيز مسودة عقد العمل لفريدة.",
          },
        },
      ]);
      mockIntent({
        intent: "general_conversation",
        requiresCapabilities: [],
        requiresContext: [],
      });

      const result = await handleChat({
        message: "اعملي عقد عمل لفريدة",
        conversationId: "conv-contract-ar",
        context: hrContext,
      });

      expect(mockExecuteCapabilitiesBoundary).toHaveBeenCalledWith(
        expect.arrayContaining(["document_generation"]),
        expect.objectContaining({
          userContext: expect.objectContaining({ targetEmployeeId: "emp-farida-123" }),
        }),
      );
      expect(result.message).toBe("تم تجهيز مسودة عقد العمل لفريدة.");
    });

    it("resolves Arabic pronoun reference: 'اعملي عقد ليها' referencing previous targetEmployeeId", async () => {
      const contextWithPreviousTarget = {
        ...hrContext,
        targetEmployeeId: "emp-nourhan-456",
        targetEmployeeName: "نورهان علي",
      };

      mockExecuteCapabilitiesBoundary.mockResolvedValueOnce([
        {
          capability: "document_generation",
          status: "success",
          data: {
            data: {
              type: "document_generation",
              status: "missing_fields",
              missing_fields: [],
            },
            message: "تم إنشاء مسودة العقد لنورهان علي.",
          },
        },
      ]);
      mockIntent({
        intent: "general_conversation",
        requiresCapabilities: [],
        requiresContext: [],
      });

      const result = await handleChat({
        message: "اعملي عقد ليها",
        conversationId: "conv-pronoun-ar",
        context: contextWithPreviousTarget,
      });

      expect(mockExecuteCapabilitiesBoundary).toHaveBeenCalledWith(
        expect.arrayContaining(["document_generation"]),
        expect.objectContaining({
          userContext: expect.objectContaining({
            targetEmployeeId: "emp-nourhan-456",
            targetEmployeeName: "نورهان علي",
          }),
        }),
      );
      expect(result.message).toBe("تم إنشاء مسودة العقد لنورهان علي.");
    });

    it("resolves English pronoun reference: 'create a contract for this employee'", async () => {
      const contextWithPreviousTarget = {
        ...hrContext,
        targetEmployeeId: "emp-nourhan-456",
        targetEmployeeName: "Nourhan Ali",
      };

      mockExecuteCapabilitiesBoundary.mockResolvedValueOnce([
        {
          capability: "document_generation",
          status: "success",
          data: {
            data: {
              type: "document_generation",
              status: "missing_fields",
              missing_fields: [],
            },
            message: "Employment contract draft generated.",
          },
        },
      ]);
      mockIntent({
        intent: "general_conversation",
        requiresCapabilities: [],
        requiresContext: [],
      });

      const result = await handleChat({
        message: "create a contract for this employee",
        conversationId: "conv-pronoun-en",
        context: contextWithPreviousTarget,
      });

      expect(mockExecuteCapabilitiesBoundary).toHaveBeenCalledWith(
        expect.arrayContaining(["document_generation"]),
        expect.objectContaining({
          userContext: expect.objectContaining({
            targetEmployeeId: "emp-nourhan-456",
          }),
        }),
      );
      expect(result.message).toBe("Employment contract draft generated.");
    });
  });

  describe("Pair 5: Egyptian Labor Law Capability Routing", () => {
    it("routes English labor law question to labor_law capability", async () => {
      mockExecuteCapabilitiesBoundary.mockResolvedValueOnce([
        {
          name: "labor_law",
          status: "success",
          data: {
            answer: "Under Egyptian Labor Law (Law No. 12 of 2003), annual leave is 21 days after one year of service.",
            sources: ["labor-law:1"],
          },
        },
      ]);
      mockIntent({
        intent: "general_conversation",
        requiresCapabilities: [],
        requiresContext: [],
      });

      const result = await handleChat({
        message: "What are the annual leave rules under Egyptian Labor Law?",
        conversationId: "conv-law-en",
        context: hrContext,
      });

      expect(mockExecuteCapabilitiesBoundary).toHaveBeenCalledWith(
        expect.arrayContaining(["labor_law"]),
        expect.anything(),
      );
      expect(result.message).toContain("Egyptian Labor Law");
    });

    it("routes Arabic labor law question to labor_law capability", async () => {
      mockExecuteCapabilitiesBoundary.mockResolvedValueOnce([
        {
          name: "labor_law",
          status: "success",
          data: {
            answer: "وفقاً لقانون العمل المصري رقم 12 لسنة 2003، يستحق الموظف إجازة سنوية قدرها 21 يوماً بعد إتمام سنة من الخدمة.",
            sources: ["labor-law:1"],
          },
        },
      ]);
      mockIntent({
        intent: "general_conversation",
        requiresCapabilities: [],
        requiresContext: [],
      });

      const result = await handleChat({
        message: "ما هي قواعد الإجازة السنوية في قانون العمل المصري؟",
        conversationId: "conv-law-ar",
        context: hrContext,
      });

      expect(mockExecuteCapabilitiesBoundary).toHaveBeenCalledWith(
        expect.arrayContaining(["labor_law"]),
        expect.anything(),
      );
      expect(result.message).toContain("قانون العمل المصري");
    });
  });

  describe("Pair 6: Company Policy Capability Routing", () => {
    it("routes English company policy question to company_policy capability", async () => {
      mockExecuteCapabilitiesBoundary.mockResolvedValueOnce([
        {
          name: "company_policy",
          status: "success",
          data: {
            answer: "According to company policy, employees receive 25 days of annual leave.",
            sources: ["company-policy:1"],
          },
        },
      ]);
      mockIntent({
        intent: "general_conversation",
        requiresCapabilities: [],
        requiresContext: [],
      });

      const result = await handleChat({
        message: "What is the company's leave policy?",
        conversationId: "conv-policy-en",
        context: hrContext,
      });

      expect(mockExecuteCapabilitiesBoundary).toHaveBeenCalledWith(
        expect.arrayContaining(["company_policy"]),
        expect.anything(),
      );
      expect(result.message).toContain("company policy");
    });

    it("routes Arabic company policy question to company_policy capability", async () => {
      mockExecuteCapabilitiesBoundary.mockResolvedValueOnce([
        {
          name: "company_policy",
          status: "success",
          data: {
            answer: "بناءً على لائحة وسياسة الشركة، يستحق الموظف 25 يوماً إجازة سنوية.",
            sources: ["company-policy:1"],
          },
        },
      ]);
      mockIntent({
        intent: "general_conversation",
        requiresCapabilities: [],
        requiresContext: [],
      });

      const result = await handleChat({
        message: "ايه سياسة الشركة بخصوص الإجازات؟",
        conversationId: "conv-policy-ar",
        context: hrContext,
      });

      expect(mockExecuteCapabilitiesBoundary).toHaveBeenCalledWith(
        expect.arrayContaining(["company_policy"]),
        expect.anything(),
      );
      expect(result.message).toContain("سياسة الشركة");
    });
  });
});
