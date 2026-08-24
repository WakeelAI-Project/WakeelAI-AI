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
    record_id: "emp-789",
    full_name: "Ahmed Mohamed",
    department: "HR",
    job_title: "HR Specialist",
    employment_status: "Active",
    leave_balance: {
      annual: { total_days: 20, used_days: 5, remaining_days: 15 },
      sick: { total_days: 10, used_days: 2, remaining_days: 8 },
      unpaid: { total_days: 0, used_days: 0, remaining_days: 0 }
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
    // Missing required full_name
    const invalidResponse = {
      record_id: "emp-789",
      department: "HR"
    };
    
    getEmployeeContextApi.mockResolvedValue(invalidResponse);

    await expect(getEmployeeContext(validAiContext)).rejects.toThrow("Invalid employee context received from backend.");
  });

  it("should return validated employee context when leave balances are uncapped (null total_days)", async () => {
    const uncappedResponse = {
      record_id: "emp-789",
      company_id: "company-456",
      full_name: "Farida Ahmed",
      role: "Employee",
      department: "Finance",
      job_title: "Financial Analyst",
      employment_status: "Active",
      salary: 12000,
      hire_date: "2022-03-15",
      leave_balance: {
        annual: { total_days: 21, used_days: 3, remaining_days: 18, is_uncapped: false },
        sick: { total_days: null, used_days: 2, remaining_days: null, is_uncapped: true },
        unpaid: { total_days: null, used_days: 0, remaining_days: null, is_uncapped: true }
      }
    };

    getEmployeeContextApi.mockResolvedValue(uncappedResponse);

    const result = await getEmployeeContext(validAiContext);

    expect(result).toEqual(uncappedResponse);
    expect(result.leave_balance.sick.total_days).toBeNull();
    expect(result.leave_balance.sick.is_uncapped).toBe(true);
  });

  it("should accept employee context when leave_balance is null or partial", async () => {
    const partialResponse = {
      record_id: "emp-789",
      full_name: "Ahmed Mohamed",
      leave_balance: null
    };

    getEmployeeContextApi.mockResolvedValue(partialResponse);

    const result = await getEmployeeContext(validAiContext);

    expect(result.record_id).toBe("emp-789");
    expect(result.leave_balance).toBeNull();
  });

  it("should rethrow integration layer errors", async () => {
    const backendError = new Error("Backend error 404 from /api/ai/employee-context");
    backendError.code = "NOT_FOUND";
    backendError.status = 404;

    getEmployeeContextApi.mockRejectedValue(backendError);

    await expect(getEmployeeContext(validAiContext)).rejects.toThrow("Backend error 404");
  });
});
