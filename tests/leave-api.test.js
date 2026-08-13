import { jest } from "@jest/globals";

const mockWakeelFetch = jest.fn();

jest.unstable_mockModule("../src/integrations/wakeel/wakeel-client.js", () => ({
  wakeelFetch: mockWakeelFetch,
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
    // employeeJwt is explicitly removed in API v8; wakeelFetch uses M2M headers
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates a draft through POST /api/ai/leave-requests using M2M JSON", async () => {
    mockWakeelFetch.mockResolvedValueOnce({
      request_id: "req-1",
      status: "Draft",
      days_requested: 3,
    });

    const result = await createLeaveDraft(
      aiContext,
      {
        leave_type: "Annual",
        start_date: "2026-08-10",
        end_date: "2026-08-12",
        reason: "Family trip",
        attachment_url: "https://storage.example.com/medical-report.pdf",
      }
    );

    expect(mockWakeelFetch).toHaveBeenCalledWith(
      "POST",
      "/api/ai/leave-requests",
      aiContext,
      {
        leave_type: "Annual",
        start_date: "2026-08-10",
        end_date: "2026-08-12",
        reason: "Family trip",
        attachment_url: "https://storage.example.com/medical-report.pdf",
      }
    );

    expect(result).toEqual({
      request_id: "req-1",
      status: "Draft",
      days_requested: 3,
    });
  });

  it("validates payload and rejects invalid leave_type", async () => {
    await expect(createLeaveDraft(
      aiContext,
      {
        leave_type: "InvalidType",
        start_date: "2026-08-10",
        end_date: "2026-08-12",
      }
    )).rejects.toMatchObject({
      code: "LEAVE_CREATE_PAYLOAD_INVALID",
      status: 400,
    });

    expect(mockWakeelFetch).not.toHaveBeenCalled();
  });

  it("submits a draft through PATCH /api/ai/leave-requests/:id/submit", async () => {
    mockWakeelFetch.mockResolvedValueOnce({
      request_id: "req-1",
      status: "Pending",
    });

    const result = await submitLeaveDraft(aiContext, "req-1");

    expect(mockWakeelFetch).toHaveBeenCalledWith(
      "PATCH",
      "/api/ai/leave-requests/req-1/submit",
      aiContext
    );

    expect(result).toEqual({
      request_id: "req-1",
      status: "Pending",
    });
  });

  it("cancels a draft through DELETE /api/ai/leave-requests/:id", async () => {
    mockWakeelFetch.mockResolvedValueOnce({});

    const result = await cancelLeaveDraft(aiContext, "req-1");

    expect(mockWakeelFetch).toHaveBeenCalledWith(
      "DELETE",
      "/api/ai/leave-requests/req-1",
      aiContext
    );

    expect(result).toEqual({
      request_id: "req-1",
      status: "Cancelled",
    });
  });

  it("preserves backend errors from wakeelFetch", async () => {
    const error = new Error("insufficient_leave_balance");
    error.status = 422;
    mockWakeelFetch.mockRejectedValueOnce(error);

    await expect(createLeaveDraft(
      aiContext,
      {
        leave_type: "Annual",
        start_date: "2026-08-10",
        end_date: "2026-08-12",
      }
    )).rejects.toThrow("insufficient_leave_balance");
  });
});
