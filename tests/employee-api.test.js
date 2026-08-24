import { jest } from "@jest/globals";

jest.unstable_mockModule("../src/integrations/wakeel/wakeel-client.js", () => ({
  wakeelFetch: jest.fn(),
}));

const { wakeelFetch } = await import("../src/integrations/wakeel/wakeel-client.js");
const { searchEmployeesByNameApi } = await import("../src/integrations/wakeel/employee-api.js");

describe("searchEmployeesByNameApi (FIX-17)", () => {
  const aiContext = { userId: "hr-1", companyId: "c1", role: "HR_Manager" };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("calls the backend search endpoint with the name URL-encoded", async () => {
    const mockResponse = { employees: [{ employee_id: "emp-1", full_name: "Ahmed Hassan" }] };
    wakeelFetch.mockResolvedValue(mockResponse);

    const result = await searchEmployeesByNameApi(aiContext, "Ahmed Hassan");

    expect(wakeelFetch).toHaveBeenCalledWith("GET", "/api/ai/employees/search?name=Ahmed%20Hassan", aiContext);
    expect(result).toEqual(mockResponse);
  });
});
