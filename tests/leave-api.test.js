import { jest } from "@jest/globals";

jest.unstable_mockModule("../src/config/env.js", () => ({
  config: {
    WAKEEL_API_BASE_URL: "https://backend.test",
  },
}));

const {
  createLeaveDraft,
  submitLeaveDraft,
  cancelLeaveDraft,
} = await import("../src/integrations/wakeel/leave-api.js");

describe("Leave API Integration", () => {
  const aiContext = {
    userId: "employee-user-1",
    companyId: "company-1",
    role: "Employee",
    conversationId: "conv-1",
    employeeJwt: "employee.jwt.token",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates a draft through POST /api/leave-requests using bearer auth and form fields", async () => {
    const fetchFn = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        request_id: "req-1",
        status: "Draft",
        days_requested: 3,
      }),
    });

    const result = await createLeaveDraft(
      aiContext,
      {
        leave_type: "Annual",
        start_date: "2026-08-10",
        end_date: "2026-08-12",
        reason: "Family trip",
      },
      { fetchFn }
    );

    expect(fetchFn).toHaveBeenCalledWith("https://backend.test/api/leave-requests", {
      method: "POST",
      headers: {
        Authorization: "Bearer employee.jwt.token",
      },
      body: expect.any(FormData),
    });

    const body = fetchFn.mock.calls[0][1].body;
    expect(body.get("leave_type")).toBe("Annual");
    expect(body.get("start_date")).toBe("2026-08-10");
    expect(body.get("end_date")).toBe("2026-08-12");
    expect(body.get("reason")).toBe("Family trip");
    expect(result).toEqual({
      request_id: "req-1",
      status: "Draft",
      days_requested: 3,
    });
  });

  it("fails closed when the employee JWT is unavailable", async () => {
    const fetchFn = jest.fn();

    await expect(createLeaveDraft(
      { ...aiContext, employeeJwt: undefined },
      {
        leave_type: "Annual",
        start_date: "2026-08-10",
        end_date: "2026-08-12",
      },
      { fetchFn }
    )).rejects.toMatchObject({
      code: "LEAVE_AUTH_TOKEN_UNAVAILABLE",
      status: 501,
    });

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("submits a draft through PATCH /api/leave-requests/{request_id}/submit", async () => {
    const fetchFn = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        request_id: "req-1",
        status: "Pending",
      }),
    });

    const result = await submitLeaveDraft(aiContext, "req-1", { fetchFn });

    expect(fetchFn).toHaveBeenCalledWith("https://backend.test/api/leave-requests/req-1/submit", {
      method: "PATCH",
      headers: {
        Authorization: "Bearer employee.jwt.token",
      },
    });
    expect(result).toEqual({
      request_id: "req-1",
      status: "Pending",
    });
  });

  it("cancels a draft through DELETE /api/leave-requests/{request_id}", async () => {
    const fetchFn = jest.fn().mockResolvedValue({
      ok: true,
    });

    const result = await cancelLeaveDraft(aiContext, "req-1", { fetchFn });

    expect(fetchFn).toHaveBeenCalledWith("https://backend.test/api/leave-requests/req-1", {
      method: "DELETE",
      headers: {
        Authorization: "Bearer employee.jwt.token",
      },
    });
    expect(result).toEqual({
      request_id: "req-1",
      status: "Cancelled",
    });
  });

  it("preserves backend error code and status", async () => {
    const fetchFn = jest.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: jest.fn().mockResolvedValue(JSON.stringify({
        error: "insufficient_leave_balance",
        message: "Requested days exceed remaining balance",
        status: 422,
      })),
    });

    await expect(createLeaveDraft(
      aiContext,
      {
        leave_type: "Annual",
        start_date: "2026-08-10",
        end_date: "2026-08-12",
      },
      { fetchFn }
    )).rejects.toMatchObject({
      code: "insufficient_leave_balance",
      status: 422,
    });
  });
});

