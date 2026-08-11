import { jest } from "@jest/globals";

jest.unstable_mockModule("../src/integrations/wakeel/wakeel-client.js", () => ({
  executeWakeelRequest: jest.fn()
}));

const { executeWakeelRequest } = await import("../src/integrations/wakeel/wakeel-client.js");
const { saveDocument } = await import("../src/integrations/wakeel/document-api.js");

describe("Document Save API Integration", () => {
  const aiContext = {
    userId: "u1",
    companyId: "c1",
    role: "HR"
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

    executeWakeelRequest.mockResolvedValue(mockResponse);

    const payload = { content: "<p>Saved</p>" };
    const result = await saveDocument(aiContext, payload);
    
    expect(executeWakeelRequest).toHaveBeenCalledWith("POST", "/api/documents/save", aiContext, payload);
    expect(result).toEqual(mockResponse);
  });

  it("should throw error on success: false", async () => {
    const mockResponse = {
      success: false,
      document_id: "doc-123",
      document_type: "Contract",
      status: "Failed",
      created_at: "2026-08-12T10:30:00Z"
    };

    executeWakeelRequest.mockResolvedValue(mockResponse);

    await expect(saveDocument(aiContext, {})).rejects.toThrow("Backend reported failure when saving the document.");
  });

  it("should throw error on invalid schema response", async () => {
    const invalidResponse = {
      success: true,
      // missing document_id
      document_type: "Contract",
      status: "Draft",
      created_at: "2026-08-12T10:30:00Z"
    };

    executeWakeelRequest.mockResolvedValue(invalidResponse);

    await expect(saveDocument(aiContext, {})).rejects.toThrow(/Invalid document save response received from backend/);
  });
});
