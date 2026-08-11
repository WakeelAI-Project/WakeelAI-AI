import { describe, it, expect, beforeEach, jest } from "@jest/globals";

// Mock the API integration layer
jest.unstable_mockModule("../src/integrations/wakeel/employee-api.js", () => ({
  getEmployeeContextApi: jest.fn()
}));

const { getEmployeeContextApi } = await import("../src/integrations/wakeel/employee-api.js");
const { getEmployeeContext } = await import("../src/services/employee-context.service.js");

describe("EmployeeContextService", () => {
  const validAiContext = {
    userId: "user-123",
    companyId: "company-456",
    role: "employee"
  };

  const validResponse = {
    employeeId: "emp-789",
    fullName: "Ahmed Mohamed",
    department: "HR",
    jobTitle: "HR Specialist",
    employmentStatus: "Active",
    leaveBalance: {
      annual: 12,
      casual: 4,
      sick: 10
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return validated employee context for valid input", async () => {
    getEmployeeContextApi.mockResolvedValue(validResponse);

    const result = await getEmployeeContext(validAiContext);

    expect(getEmployeeContextApi).toHaveBeenCalledWith(validAiContext);
    expect(result).toEqual(validResponse);
  });

  it("should throw an error if userId is missing from context", async () => {
    const invalidContext = { ...validAiContext, userId: undefined };

    await expect(getEmployeeContext(invalidContext)).rejects.toThrow("Missing required AI Context for employee context retrieval.");
    expect(getEmployeeContextApi).not.toHaveBeenCalled();
  });

  it("should throw an error if companyId is missing from context", async () => {
    const invalidContext = { ...validAiContext, companyId: undefined };

    await expect(getEmployeeContext(invalidContext)).rejects.toThrow("Missing required AI Context for employee context retrieval.");
    expect(getEmployeeContextApi).not.toHaveBeenCalled();
  });

  it("should throw an error if the backend returns invalid context shape", async () => {
    // Missing required fullName
    const invalidResponse = {
      employeeId: "emp-789",
      department: "HR"
    };
    
    getEmployeeContextApi.mockResolvedValue(invalidResponse);

    await expect(getEmployeeContext(validAiContext)).rejects.toThrow("Invalid employee context received from backend.");
  });

  it("should rethrow integration layer errors", async () => {
    const backendError = new Error("Backend error 404 from /api/ai/context/employee");
    backendError.code = "NOT_FOUND";
    backendError.status = 404;

    getEmployeeContextApi.mockRejectedValue(backendError);

    await expect(getEmployeeContext(validAiContext)).rejects.toThrow("Backend error 404");
  });
});
