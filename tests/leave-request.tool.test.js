import { jest } from "@jest/globals";

const mockHandleLeaveRequest = jest.fn();
jest.unstable_mockModule("../src/services/leave-request.service.js", () => ({
  handleLeaveRequest: mockHandleLeaveRequest,
}));

const { default: leaveRequestTool } = await import("../src/tools/leave-request.tool.js");

describe("LeaveRequestTool", () => {
  const context = {
    userId: "employee-user-1",
    companyId: "company-1",
    role: "Employee",
    conversationId: "conv-1",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("has the expected tool contract", () => {
    expect(leaveRequestTool.name).toBe("leave_request");
    expect(typeof leaveRequestTool.description).toBe("string");
    expect(leaveRequestTool.inputSchema).toBeDefined();
    expect(typeof leaveRequestTool.execute).toBe("function");
  });

  it("wraps service results in the standard capability result shape", async () => {
    const resultCard = {
      type: "leave_draft",
      request_id: "req-1",
      leave_type: "Annual",
      start_date: "2026-08-10",
      end_date: "2026-08-12",
      days_requested: 3,
      attachment_uploaded: false,
      actions: [],
    };

    mockHandleLeaveRequest.mockResolvedValue({
      success: true,
      status: "submitted",
      message: "I've submitted your annual leave request. It is pending HR approval.",
      sources: [],
      result_card: resultCard,
      action: {
        type: "leave_request",
        payload: {
          request_id: "req-1",
          status: "Pending",
        },
      },
      leave_request: {
        request_id: "req-1",
        status: "Pending",
      },
      employee_context_used: true,
    });

    const result = await leaveRequestTool.execute("Yes, create it.", context);

    expect(mockHandleLeaveRequest).toHaveBeenCalledWith({
      message: "Yes, create it.",
      aiContext: context,
    });
    expect(result).toEqual({
      success: true,
      data: {
        type: "leave_request",
        status: "submitted",
        missing_fields: undefined,
        result_card: resultCard,
        leave_request: {
          request_id: "req-1",
          status: "Pending",
        },
        error: undefined,
        employee_context_used: true,
      },
      message: "I've submitted your annual leave request. It is pending HR approval.",
      sources: [],
      action: {
        type: "leave_request",
        payload: {
          request_id: "req-1",
          status: "Pending",
        },
      },
    });
  });
});

