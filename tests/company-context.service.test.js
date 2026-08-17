import { describe, it, expect, beforeEach, jest } from "@jest/globals";

// Mock the API integration layer
jest.unstable_mockModule("../src/integrations/wakeel/company-api.js", () => ({
  getCompanyContextApi: jest.fn()
}));

const { getCompanyContextApi } = await import("../src/integrations/wakeel/company-api.js");
const { getCompanyContext } = await import("../src/services/company-context.service.js");

describe("CompanyContextService", () => {
  const validAiContext = {
    userId: "user-123",
    companyId: "company-456",
    role: "employee"
  };

  const validResponse = {
    id: "company-456",
    name: "Example Company",
    tax_id: "123-456"
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return validated company context for valid input", async () => {
    getCompanyContextApi.mockResolvedValue(validResponse);

    const result = await getCompanyContext(validAiContext);

    expect(getCompanyContextApi).toHaveBeenCalledWith(validAiContext);
    expect(result).toEqual({
      companyId: "company-456",
      companyName: "Example Company",
      taxId: "123-456",
      industry: null,
      workingHours: null,
      address: null,
      phoneNumber: null,
      email: null,
      logoUrl: null,
      registeredAt: null,
      policyAvailable: false,
    });
  });

  it("should throw an error if companyId is missing from context", async () => {
    const invalidContext = { ...validAiContext, companyId: undefined };

    await expect(getCompanyContext(invalidContext)).rejects.toThrow("Missing required AI Context for company context retrieval.");
    expect(getCompanyContextApi).not.toHaveBeenCalled();
  });

  it("should throw an error if the backend returns invalid context shape", async () => {
    // Missing required name
    const invalidResponse = {
      id: "company-456",
    };
    
    getCompanyContextApi.mockResolvedValue(invalidResponse);

    await expect(getCompanyContext(validAiContext)).rejects.toThrow("Invalid company context received from backend.");
  });

  it("should rethrow integration layer errors", async () => {
    const backendError = new Error("Backend error 404 from /api/ai/company-context");
    backendError.code = "NOT_FOUND";
    backendError.status = 404;

    getCompanyContextApi.mockRejectedValue(backendError);

    await expect(getCompanyContext(validAiContext)).rejects.toThrow("Backend error 404");
  });
});
