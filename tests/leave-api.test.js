import { jest } from "@jest/globals";

const mockWakeelFetch = jest.fn();

jest.unstable_mockModule("../src/integrations/wakeel/wakeel-client.js", () => ({
  wakeelFetch: mockWakeelFetch,
}));

const {
  createLeaveDraft,
  submitLeaveDraft,
  cancelLeaveDraft,
  getLatestLeaveDraft,
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

  it("preserves structured backend error with code and message for overlapping leave", async () => {
    const error = new Error("An overlapping leave request already exists.");
    error.code = "BACKEND_ERROR";
    error.status = 409;
    error.backendError = "overlapping_leave_request";
    error.backendMessage = "An overlapping leave request already exists.";
    mockWakeelFetch.mockRejectedValueOnce(error);

    await expect(createLeaveDraft(
      aiContext,
      {
        leave_type: "Annual",
        start_date: "2026-08-10",
        end_date: "2026-08-12",
      }
    )).rejects.toMatchObject({
      backendError: "overlapping_leave_request",
      backendMessage: "An overlapping leave request already exists.",
      status: 409,
    });
  });

  it("preserves structured backend error for insufficient balance", async () => {
    const error = new Error("Requested days exceed the employee's remaining leave balance.");
    error.code = "BACKEND_ERROR";
    error.status = 422;
    error.backendError = "insufficient_leave_balance";
    error.backendMessage = "Requested days exceed the employee's remaining leave balance.";
    mockWakeelFetch.mockRejectedValueOnce(error);

    await expect(createLeaveDraft(
      aiContext,
      {
        leave_type: "Annual",
        start_date: "2026-08-10",
        end_date: "2026-08-12",
      }
    )).rejects.toMatchObject({
      backendError: "insufficient_leave_balance",
      status: 422,
    });
  });

  it("preserves structured backend error for attachment_required", async () => {
    const error = new Error("Medical report attachment URL is required for Sick leave.");
    error.code = "BACKEND_ERROR";
    error.status = 422;
    error.backendError = "attachment_required";
    error.backendMessage = "Medical report attachment URL is required for Sick leave.";
    mockWakeelFetch.mockRejectedValueOnce(error);

    await expect(createLeaveDraft(
      aiContext,
      {
        leave_type: "Sick",
        start_date: "2026-08-10",
        end_date: "2026-08-12",
      }
    )).rejects.toMatchObject({
      backendError: "attachment_required",
      status: 422,
    });
  });

  it("preserves structured backend error for not_a_draft when submitting", async () => {
    const error = new Error("Leave request has already been submitted.");
    error.code = "BACKEND_ERROR";
    error.status = 409;
    error.backendError = "not_a_draft";
    error.backendMessage = "Leave request has already been submitted.";
    mockWakeelFetch.mockRejectedValueOnce(error);

    await expect(submitLeaveDraft(aiContext, "req-1")).rejects.toMatchObject({
      backendError: "not_a_draft",
      status: 409,
    });
  });

  it("preserves structured backend error for leave_request_not_found", async () => {
    const error = new Error("Leave request not found or does not belong to this employee.");
    error.code = "NOT_FOUND";
    error.status = 404;
    error.backendError = "leave_request_not_found";
    error.backendMessage = "Leave request not found or does not belong to this employee.";
    mockWakeelFetch.mockRejectedValueOnce(error);

    await expect(submitLeaveDraft(aiContext, "req-nonexistent")).rejects.toMatchObject({
      backendError: "leave_request_not_found",
      status: 404,
    });
  });

  describe("getLatestLeaveDraft", () => {
    const DRAFT_GUID = "6f1c2a34-5b6d-4e7f-8a90-b1c2d3e4f567";

    it("GETs the internal latest-draft endpoint with the M2M context", async () => {
      mockWakeelFetch.mockResolvedValueOnce({
        request_id: DRAFT_GUID,
        leave_type: "Annual",
        start_date: "2030-09-01",
        end_date: "2030-09-03",
        days_requested: 3,
        status: "Draft",
      });

      const result = await getLatestLeaveDraft(aiContext);

      expect(mockWakeelFetch).toHaveBeenCalledWith(
        "GET",
        "/api/ai/leave-requests/latest-draft",
        aiContext,
      );
      expect(result.request_id).toBe(DRAFT_GUID);
    });

    it("treats 404 as 'no draft found', not an error", async () => {
      const error = new Error("Resource not found");
      error.status = 404;
      mockWakeelFetch.mockRejectedValueOnce(error);

      await expect(getLatestLeaveDraft(aiContext)).resolves.toBeNull();
    });

    it("returns null for an empty body", async () => {
      mockWakeelFetch.mockResolvedValueOnce(null);
      await expect(getLatestLeaveDraft(aiContext)).resolves.toBeNull();
    });

    it("returns null when the payload has no usable request_id", async () => {
      mockWakeelFetch.mockResolvedValueOnce({ status: "Draft" });
      await expect(getLatestLeaveDraft(aiContext)).resolves.toBeNull();
    });

    it("rethrows non-404 backend failures", async () => {
      const error = new Error("boom");
      error.status = 500;
      mockWakeelFetch.mockRejectedValueOnce(error);

      await expect(getLatestLeaveDraft(aiContext)).rejects.toThrow("boom");
    });
  });
});
