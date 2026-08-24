import { jest } from "@jest/globals";

const mockGenerateDocument = jest.fn();
const mockExtractFieldValuesFromMessage = jest.fn();
const mockSearchEmployeesByNameApi = jest.fn();

jest.unstable_mockModule("../src/services/document-generation.service.js", () => ({
  generateDocument: mockGenerateDocument,
  extractFieldValuesFromMessage: mockExtractFieldValuesFromMessage,
}));

jest.unstable_mockModule("../src/integrations/wakeel/employee-api.js", () => ({
  searchEmployeesByNameApi: mockSearchEmployeesByNameApi,
}));

const { default: documentGenerationSkill } = await import("../src/skills/document-generation/document-generation.skill.js");

describe("DocumentGenerationSkill", () => {
  const context = {
    userId: "hr-1",
    companyId: "company-1",
    role: "HR_Manager",
    conversationId: "conv-1",
    targetEmployeeId: "emp-1",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("has the expected skill contract", () => {
    expect(documentGenerationSkill.name).toBe("document_generation");
    expect(typeof documentGenerationSkill.description).toBe("string");
    expect(documentGenerationSkill.inputSchema).toBeDefined();
    expect(typeof documentGenerationSkill.execute).toBe("function");
  });

  it("wraps a saved draft service result in the standard skill result shape", async () => {
    const resultCard = {
      type: "document_draft",
      doc_id: "doc-1",
      doc_type: "Contract",
      employee_id: "emp-1",
      employee_name: "Ahmed",
    };

    mockGenerateDocument.mockResolvedValue({
      success: true,
      status: "saved",
      message: "I've created and saved Employment Contract - Ahmed as a draft.",
      sources: [],
      result_card: resultCard,
      document: {
        document_id: "doc-1",
        document_type: "Contract",
        status: "draft",
      },
    });

    const result = await documentGenerationSkill.execute("Create an employment contract", context);

    expect(mockGenerateDocument).toHaveBeenCalledWith(expect.objectContaining({
      message: "Create an employment contract",
      aiContext: expect.objectContaining({
        companyId: "company-1",
        role: "HR_Manager",
        targetEmployeeId: "emp-1",
      }),
    }));
    expect(result.success).toBe(true);
    expect(result.message).toContain("Employment Contract");
    expect(result.sources).toEqual([]);
    expect(result.action).toBeNull();
    expect(result.data).toEqual({
      type: "document_generation",
      status: "saved",
      missing_fields: undefined,
      result_card: resultCard,
      document: {
        document_id: "doc-1",
        document_type: "Contract",
        status: "draft",
      },
      error: undefined,
    });
  });

  it("wraps missing fields without attempting to fabricate a result card", async () => {
    const missingFields = [{
      field_name: "employee_id",
      input_type: "text",
      label: "Employee ID",
      options: [],
    }];

    mockGenerateDocument.mockResolvedValue({
      success: true,
      status: "missing_fields",
      message: "I need a few required fields first.",
      missing_fields: missingFields,
      sources: [],
    });

    const result = await documentGenerationSkill.execute("Create an employment contract", context);

    expect(result.success).toBe(true);
    expect(result.data.type).toBe("document_generation");
    expect(result.data.status).toBe("missing_fields");
    expect(result.data.missing_fields).toEqual(missingFields);
    expect(result.data.result_card).toBeUndefined();
  });
});

describe("DocumentGenerationSkill - no employee targeted (FIX-17)", () => {
  const noTargetContext = {
    userId: "hr-1",
    companyId: "company-1",
    role: "HR_Manager",
    conversationId: "conv-1",
    targetEmployeeId: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns a friendly instruction instead of a bare error when no name was typed", async () => {
    mockExtractFieldValuesFromMessage.mockReturnValue({});

    const result = await documentGenerationSkill.execute("Generate an employment contract", noTargetContext);

    expect(mockSearchEmployeesByNameApi).not.toHaveBeenCalled();
    expect(mockGenerateDocument).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.data.error.code).toBe("MISSING_TARGET_EMPLOYEE");
    expect(result.message).toContain("tell me the employee's name");
  });

  it("resolves a single name match and continues generation with the resolved employee", async () => {
    mockExtractFieldValuesFromMessage.mockReturnValue({ employee_name: "Ahmed Hassan" });
    mockSearchEmployeesByNameApi.mockResolvedValue({
      employees: [{ employee_id: "emp-42", full_name: "Ahmed Hassan" }],
    });
    mockGenerateDocument.mockResolvedValue({
      success: true,
      status: "missing_fields",
      message: "I need a few required fields first.",
      missing_fields: [],
      sources: [],
    });

    const result = await documentGenerationSkill.execute("Generate a contract for Ahmed Hassan", noTargetContext);

    expect(mockSearchEmployeesByNameApi).toHaveBeenCalledWith(noTargetContext, "Ahmed Hassan");
    expect(mockGenerateDocument).toHaveBeenCalledWith(expect.objectContaining({
      aiContext: expect.objectContaining({ targetEmployeeId: "emp-42" }),
    }));
    expect(result.success).toBe(true);
  });

  it("reports no match found by name without failing silently", async () => {
    mockExtractFieldValuesFromMessage.mockReturnValue({ employee_name: "Nobody Here" });
    mockSearchEmployeesByNameApi.mockResolvedValue({ employees: [] });

    const result = await documentGenerationSkill.execute("Generate a contract for Nobody Here", noTargetContext);

    expect(mockGenerateDocument).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.data.error.code).toBe("MISSING_TARGET_EMPLOYEE");
    expect(result.message).toContain("Nobody Here");
  });

  it("asks for clarification when the typed name matches more than one employee", async () => {
    mockExtractFieldValuesFromMessage.mockReturnValue({ employee_name: "Ahmed" });
    mockSearchEmployeesByNameApi.mockResolvedValue({
      employees: [
        { employee_id: "emp-1", full_name: "Ahmed Hassan" },
        { employee_id: "emp-2", full_name: "Ahmed Ali" },
      ],
    });

    const result = await documentGenerationSkill.execute("Generate a contract for Ahmed", noTargetContext);

    expect(mockGenerateDocument).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.message).toContain("Ahmed Hassan");
    expect(result.message).toContain("Ahmed Ali");
  });

  it("falls back to the friendly instruction when the lookup call itself fails", async () => {
    mockExtractFieldValuesFromMessage.mockReturnValue({ employee_name: "Ahmed Hassan" });
    mockSearchEmployeesByNameApi.mockRejectedValue(new Error("network error"));

    const result = await documentGenerationSkill.execute("Generate a contract for Ahmed Hassan", noTargetContext);

    expect(mockGenerateDocument).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.data.error.code).toBe("MISSING_TARGET_EMPLOYEE");
  });
});
