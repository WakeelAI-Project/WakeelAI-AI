import { jest } from "@jest/globals";

jest.unstable_mockModule("../src/integrations/wakeel/wakeel-client.js", () => ({
  wakeelFetch: jest.fn()
}));

const { wakeelFetch } = await import("../src/integrations/wakeel/wakeel-client.js");
const { saveDocument } = await import("../src/integrations/wakeel/document-api.js");

describe("Document Save API Integration", () => {
  const aiContext = {
    userId: "u1",
    companyId: "c1",
    role: "HR"
  };

  const validPayload = {
    document_type: "Contract",
    title: "Employment Contract - Ahmed",
    content_html: "<p>Saved</p>",
    employee_id: "emp-789",
    template_id: "tpl-123",
    metadata: { department: "Engineering" }
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return success response", async () => {
    const mockResponse = {
      success: true,
      document_id: "doc-123",
      document_type: "Contract",
      status: "Draft",
      created_at: "2026-08-12T10:30:00Z"
    };

    wakeelFetch.mockResolvedValue(mockResponse);

    const result = await saveDocument(aiContext, validPayload);

    expect(wakeelFetch).toHaveBeenCalledWith("POST", "/api/ai/documents/save", aiContext, validPayload);
    expect(result).toEqual(mockResponse);
  });

  it("should accept a payload without the optional template_id/metadata fields", async () => {
    const mockResponse = {
      success: true,
      document_id: "doc-124",
      document_type: "Warning",
      status: "Draft",
      created_at: "2026-08-12T10:30:00Z"
    };
    const { template_id, metadata, ...minimalPayload } = validPayload;

    wakeelFetch.mockResolvedValue(mockResponse);

    const result = await saveDocument(aiContext, minimalPayload);

    expect(wakeelFetch).toHaveBeenCalledWith("POST", "/api/ai/documents/save", aiContext, minimalPayload);
    expect(result).toEqual(mockResponse);
  });

  it("should accept a payload without employee_id for a new-employee document draft", async () => {
    const mockResponse = {
      success: true,
      document_id: "doc-125",
      document_type: "Contract",
      status: "Draft",
      created_at: "2026-08-12T10:30:00Z"
    };
    const { employee_id, ...payloadWithoutEmployeeId } = validPayload;

    wakeelFetch.mockResolvedValue(mockResponse);

    const result = await saveDocument(aiContext, payloadWithoutEmployeeId);

    expect(wakeelFetch).toHaveBeenCalledWith("POST", "/api/ai/documents/save", aiContext, payloadWithoutEmployeeId);
    expect(result).toEqual(mockResponse);
  });

  it("should reject a payload missing required fields before calling the backend", async () => {
    const { content_html, ...invalidPayload } = validPayload;

    await expect(saveDocument(aiContext, invalidPayload)).rejects.toThrow(/Invalid document save payload/);
    expect(wakeelFetch).not.toHaveBeenCalled();
  });

  it("should reject a payload that duplicates trusted identity fields", async () => {
    const invalidPayload = { ...validPayload, companyId: "c1" };

    await expect(saveDocument(aiContext, invalidPayload)).rejects.toThrow(/Invalid document save payload/);
    expect(wakeelFetch).not.toHaveBeenCalled();
  });

  it("should throw error on success: false", async () => {
    const mockResponse = {
      success: false,
      document_id: "doc-123",
      document_type: "Contract",
      status: "Failed",
      created_at: "2026-08-12T10:30:00Z"
    };

    wakeelFetch.mockResolvedValue(mockResponse);

    await expect(saveDocument(aiContext, validPayload)).rejects.toThrow("Backend reported failure when saving the document.");
  });

  it("should throw error on invalid schema response", async () => {
    const invalidResponse = {
      success: true,
      // missing document_id
      document_type: "Contract",
      status: "Draft",
      created_at: "2026-08-12T10:30:00Z"
    };

    wakeelFetch.mockResolvedValue(invalidResponse);

    await expect(saveDocument(aiContext, validPayload)).rejects.toThrow(/Invalid document save response received from backend/);
  });
});
