import { jest } from "@jest/globals";

jest.unstable_mockModule("../src/integrations/wakeel/wakeel-client.js", () => ({
  wakeelFetch: jest.fn()
}));

const { wakeelFetch } = await import("../src/integrations/wakeel/wakeel-client.js");
const { getActiveTemplate } = await import("../src/integrations/wakeel/template-api.js");

describe("Template API Integration", () => {
  const aiContext = {
    userId: "u1",
    companyId: "c1",
    role: "HR"
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return valid template on success", async () => {
    const mockResponse = {
      template_id: "uuid-123",
      document_type: "Contract",
      name: "Default Contract",
      content_template: "<p>Hello</p>"
    };

    wakeelFetch.mockResolvedValue(mockResponse);

    const result = await getActiveTemplate(aiContext, "Contract");
    expect(wakeelFetch).toHaveBeenCalledWith("GET", "/api/ai/templates/active?documentType=Contract", aiContext);
    expect(result).toEqual(mockResponse);
  });

  it("should throw error if backend returns 404", async () => {
    const err = new Error("Not Found");
    err.status = 404;
    wakeelFetch.mockRejectedValue(err);

    await expect(getActiveTemplate(aiContext, "Contract")).rejects.toThrow("Active template not found for documentType: Contract");
  });

  it("should throw error on invalid schema response", async () => {
    const invalidResponse = {
      template_id: "uuid-123",
      // missing document_type
      name: "Default Contract"
    };

    wakeelFetch.mockResolvedValue(invalidResponse);

    await expect(getActiveTemplate(aiContext, "Contract")).rejects.toThrow(/Invalid template response received from backend/);
  });
});
