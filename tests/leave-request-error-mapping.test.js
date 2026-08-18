import { jest } from "@jest/globals";

const mockCreateLeaveDraft = jest.fn();

jest.unstable_mockModule("../src/integrations/wakeel/leave-api.js", () => ({
  createLeaveDraft: mockCreateLeaveDraft,
  submitLeaveDraft: jest.fn(),
  cancelLeaveDraft: jest.fn(),
}));

const mockGetEmployeeContext = jest.fn();
jest.unstable_mockModule("../src/services/employee-context.service.js", () => ({
  getEmployeeContext: mockGetEmployeeContext,
}));

const { handleCreateLeaveDraft } = await import("../src/services/leave-request.service.js");

describe("Leave Request Service - Backend Error Mapping", () => {
  const aiContext = {
    userId: "employee-1",
    companyId: "company-1",
    role: "Employee",
    conversationId: "conv-1",
  };

  // Use future dates that will pass validation
  const futureDate1 = "2027-12-10";
  const futureDate2 = "2027-12-12";

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateLeaveDraft.mockReset();
    mockGetEmployeeContext.mockReset();
  });

  it("maps overlapping_leave_request error to user-friendly message", async () => {
    const backendError = new Error("An overlapping leave request already exists.");
    backendError.code = "BACKEND_ERROR";
    backendError.status = 409;
    backendError.backendError = "overlapping_leave_request";
    backendError.backendMessage = "An overlapping leave request already exists.";
    
    mockCreateLeaveDraft.mockRejectedValueOnce(backendError);

    const result = await handleCreateLeaveDraft(aiContext, {
      leave_type: "Annual",
      start_date: futureDate1,
      end_date: futureDate2,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe("error");
    expect(result.error.code).toBe("overlapping_leave_request");
    expect(result.error.status).toBe(409);
    expect(result.message).toBe("You already have a leave request that overlaps with these dates.");
  });

  it("maps insufficient_leave_balance error to user-friendly message", async () => {
    const backendError = new Error("Requested days exceed the employee's remaining leave balance.");
    backendError.code = "BACKEND_ERROR";
    backendError.status = 422;
    backendError.backendError = "insufficient_leave_balance";
    backendError.backendMessage = "Requested days exceed the employee's remaining leave balance.";
    
    mockCreateLeaveDraft.mockRejectedValueOnce(backendError);

    const result = await handleCreateLeaveDraft(aiContext, {
      leave_type: "Annual",
      start_date: futureDate1,
      end_date: futureDate2,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe("error");
    expect(result.error.code).toBe("insufficient_leave_balance");
    expect(result.error.status).toBe(422);
    expect(result.message).toBe("You do not have enough leave balance for this request.");
  });

  it("maps attachment_required error to user-friendly message", async () => {
    const backendError = new Error("Medical report attachment URL is required for Sick leave.");
    backendError.code = "BACKEND_ERROR";
    backendError.status = 422;
    backendError.backendError = "attachment_required";
    backendError.backendMessage = "Medical report attachment URL is required for Sick leave.";
    
    mockCreateLeaveDraft.mockRejectedValueOnce(backendError);

    // Provide attachment_url to bypass local validation and reach backend
    const result = await handleCreateLeaveDraft(aiContext, {
      leave_type: "Sick",
      start_date: futureDate1,
      end_date: futureDate2,
      attachment_url: "https://example.com/report.pdf", // Provided but backend rejects it
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe("error");
    expect(result.error.code).toBe("attachment_required");
    expect(result.error.status).toBe(422);
    expect(result.message).toContain("Sick leave requires a medical report attachment");
  });

  it("maps not_a_draft error to user-friendly message", async () => {
    const backendError = new Error("Leave request has already been submitted.");
    backendError.code = "BACKEND_ERROR";
    backendError.status = 409;
    backendError.backendError = "not_a_draft";
    backendError.backendMessage = "Leave request has already been submitted.";
    
    mockCreateLeaveDraft.mockRejectedValueOnce(backendError);

    const result = await handleCreateLeaveDraft(aiContext, {
      leave_type: "Annual",
      start_date: futureDate1,
      end_date: futureDate2,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe("error");
    expect(result.error.code).toBe("not_a_draft");
    expect(result.error.status).toBe(409);
    expect(result.message).toBe("That leave request has already been submitted or is no longer a draft.");
  });

  it("maps leave_request_not_found error to user-friendly message", async () => {
    const backendError = new Error("Leave request not found or does not belong to this employee.");
    backendError.code = "NOT_FOUND";
    backendError.status = 404;
    backendError.backendError = "leave_request_not_found";
    backendError.backendMessage = "Leave request not found or does not belong to this employee.";
    
    mockCreateLeaveDraft.mockRejectedValueOnce(backendError);

    const result = await handleCreateLeaveDraft(aiContext, {
      leave_type: "Annual",
      start_date: futureDate1,
      end_date: futureDate2,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe("error");
    expect(result.error.code).toBe("leave_request_not_found");
    expect(result.error.status).toBe(404);
    expect(result.message).toBe("I could not find that leave request for your account.");
  });

  it("maps validation_error to user-friendly message", async () => {
    const backendError = new Error("Invalid dates or unsupported leave type.");
    backendError.code = "BACKEND_ERROR";
    backendError.status = 400;
    backendError.backendError = "validation_error";
    backendError.backendMessage = "Invalid dates or unsupported leave type.";
    
    mockCreateLeaveDraft.mockRejectedValueOnce(backendError);

    const result = await handleCreateLeaveDraft(aiContext, {
      leave_type: "Annual",
      start_date: futureDate1,
      end_date: futureDate2,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe("error");
    expect(result.error.code).toBe("validation_error");
    expect(result.error.status).toBe(400);
    expect(result.message).toBe("The leave dates or leave request details are invalid.");
  });

  it("maps invalid_attachment error to user-friendly message", async () => {
    const backendError = new Error("Invalid attachment URL or cross-company request.");
    backendError.code = "BACKEND_ERROR";
    backendError.status = 422;
    backendError.backendError = "invalid_attachment";
    backendError.backendMessage = "Invalid attachment URL or cross-company request.";
    
    mockCreateLeaveDraft.mockRejectedValueOnce(backendError);

    const result = await handleCreateLeaveDraft(aiContext, {
      leave_type: "Sick",
      start_date: futureDate1,
      end_date: futureDate2,
      attachment_url: "https://example.com/fake.pdf",
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe("error");
    expect(result.error.code).toBe("invalid_attachment");
    expect(result.error.status).toBe(422);
    expect(result.message).toBe("The attachment URL is invalid or does not belong to your company.");
  });

  it("uses backend message for unknown error codes", async () => {
    const backendError = new Error("Some specific backend validation failed.");
    backendError.code = "BACKEND_ERROR";
    backendError.status = 400;
    backendError.backendError = "unknown_future_error";
    backendError.backendMessage = "Some specific backend validation failed.";
    
    mockCreateLeaveDraft.mockRejectedValueOnce(backendError);

    const result = await handleCreateLeaveDraft(aiContext, {
      leave_type: "Annual",
      start_date: futureDate1,
      end_date: futureDate2,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe("error");
    expect(result.error.code).toBe("unknown_future_error");
    expect(result.message).toBe("Some specific backend validation failed.");
  });

  it("provides generic message when backend message is unavailable", async () => {
    const backendError = new Error("Backend error 500 from /api/ai/leave-requests");
    backendError.code = "BACKEND_ERROR";
    backendError.status = 500;
    
    mockCreateLeaveDraft.mockRejectedValueOnce(backendError);

    const result = await handleCreateLeaveDraft(aiContext, {
      leave_type: "Annual",
      start_date: futureDate1,
      end_date: futureDate2,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe("error");
    expect(result.error.status).toBe(500);
    expect(result.message).toBe("I could not complete the leave request.");
  });

  it("maps forbidden error to user-friendly message", async () => {
    const backendError = new Error("Only employees can request leave.");
    backendError.code = "UNAUTHORIZED_BACKEND";
    backendError.status = 403;
    backendError.backendError = "forbidden";
    backendError.backendMessage = "Only employees can request leave.";
    
    mockCreateLeaveDraft.mockRejectedValueOnce(backendError);

    const result = await handleCreateLeaveDraft(aiContext, {
      leave_type: "Annual",
      start_date: futureDate1,
      end_date: futureDate2,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe("error");
    expect(result.error.code).toBe("forbidden");
    expect(result.error.status).toBe(403);
    expect(result.message).toBe("You are not authorized to perform this action.");
  });
});
