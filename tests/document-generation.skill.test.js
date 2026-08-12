import { jest } from "@jest/globals";

const mockGenerateDocument = jest.fn();

jest.unstable_mockModule("../src/services/document-generation.service.js", () => ({
  generateDocument: mockGenerateDocument,
}));

const { default: documentGenerationSkill } = await import("../src/skills/document-generation/document-generation.skill.js");

describe("DocumentGenerationSkill", () => {
  const context = {
    userId: "hr-1",
    companyId: "company-1",
    role: "HR",
    conversationId: "conv-1",
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

    expect(mockGenerateDocument).toHaveBeenCalledWith({
      message: "Create an employment contract",
      aiContext: context,
    });
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
