import { jest } from "@jest/globals";
import {
  handleLeaveRequest,
  extractLeaveFieldsFromMessage,
  normalizeLeaveType,
} from "../src/services/leave-request.service.js";

describe("LeaveRequestService", () => {
  const aiContext = {
    userId: "employee-user-1",
    companyId: "company-1",
    role: "Employee",
    conversationId: "conv-1",
  };
  const baseDate = new Date("2026-08-01T00:00:00Z");
  const employeeContext = {
    record_id: "employee-user-1",
    full_name: "Ahmed Mohamed",
    leave_balance: {
      annual: { total_days: 15, used_days: 5, remaining_days: 10 },
      sick: { total_days: 10, used_days: 2, remaining_days: 8 },
      unpaid: { total_days: null, used_days: 0, remaining_days: null },
    },
  };

  const createDependencies = (overrides = {}) => ({
    baseDate,
    getEmployeeContextFn: jest.fn().mockResolvedValue(employeeContext),
    getConversationHistoryFn: jest.fn().mockResolvedValue({ messages: [] }),
    retrieveKnowledgeFn: jest.fn().mockResolvedValue({ sources: [], chunks: [] }),
    createLeaveDraftFn: jest.fn().mockResolvedValue({
      request_id: "req-1",
      status: "Draft",
      days_requested: 3,
    }),
    submitLeaveDraftFn: jest.fn().mockResolvedValue({
      request_id: "req-1",
      status: "Pending",
    }),
    cancelLeaveDraftFn: jest.fn().mockResolvedValue({
      request_id: "req-1",
      status: "Cancelled",
    }),
    ...overrides,
  });

  it("normalizes exact backend leave type values", () => {
    expect(normalizeLeaveType("annual vacation")).toBe("Annual");
    expect(normalizeLeaveType("sick medical leave")).toBe("Sick");
    expect(normalizeLeaveType("unpaid leave")).toBe("Unpaid");
    expect(normalizeLeaveType("holiday")).toBeNull();
  });

  it("extracts leave fields from natural language without employee IDs", () => {
    const values = extractLeaveFieldsFromMessage("Annual leave from August 10 to August 12 because travel", {
      baseDate,
    });

    expect(values).toEqual({
      leave_type: "Annual",
      start_date: "2026-08-10",
      end_date: "2026-08-12",
      reason: "travel",
    });
  });

  it("returns missing_fields when leave type is missing", async () => {
    const dependencies = createDependencies();

    const result = await handleLeaveRequest({
      message: "I want to take leave from August 10 to August 12",
      aiContext,
      conversationMessages: [],
    }, dependencies);

    expect(result.status).toBe("missing_fields");
    expect(result.missing_fields.map((field) => field.field_name)).toEqual(["leave_type"]);
    expect(dependencies.createLeaveDraftFn).not.toHaveBeenCalled();
  });

  it("returns missing_fields when start date is missing", async () => {
    const dependencies = createDependencies();

    const result = await handleLeaveRequest({
      message: "Please create annual leave request until August 12",
      aiContext,
      conversationMessages: [],
    }, dependencies);

    expect(result.status).toBe("missing_fields");
    expect(result.missing_fields.map((field) => field.field_name)).toEqual(["start_date"]);
    expect(dependencies.createLeaveDraftFn).not.toHaveBeenCalled();
  });

  it("returns missing_fields when end date is missing", async () => {
    const dependencies = createDependencies();

    const result = await handleLeaveRequest({
      message: "Please create annual leave request from August 10",
      aiContext,
      conversationMessages: [],
    }, dependencies);

    expect(result.status).toBe("missing_fields");
    expect(result.missing_fields.map((field) => field.field_name)).toEqual(["end_date"]);
    expect(dependencies.createLeaveDraftFn).not.toHaveBeenCalled();
  });

  it("answers balance questions with existing employee context", async () => {
    const dependencies = createDependencies();

    const result = await handleLeaveRequest({
      message: "How many annual leave days do I have left?",
      aiContext,
      conversationMessages: [],
    }, dependencies);

    expect(result.status).toBe("info");
    expect(result.employee_context_used).toBe(true);
    expect(result.message).toContain("10 remaining");
    expect(dependencies.getEmployeeContextFn).toHaveBeenCalledWith(aiContext);
    expect(dependencies.createLeaveDraftFn).not.toHaveBeenCalled();
  });

  it("does not create a leave request for an eligibility question", async () => {
    const dependencies = createDependencies();

    const result = await handleLeaveRequest({
      message: "Can I take annual leave from August 10 to August 12?",
      aiContext,
      conversationMessages: [],
    }, dependencies);

    expect(result.status).toBe("eligibility");
    expect(result.message).toContain("appear able");
    expect(dependencies.createLeaveDraftFn).not.toHaveBeenCalled();
    expect(dependencies.submitLeaveDraftFn).not.toHaveBeenCalled();
  });

  it("uses RAG only when policy or legal reasoning is requested", async () => {
    const retrieveKnowledgeFn = jest.fn().mockResolvedValue({
      sources: [{
        id: "policy-1:0",
        title: "Leave Policy",
        type: "company-policy",
        content: "Annual leave requires manager review.",
        metadata: {},
      }],
      chunks: [],
    });
    const dependencies = createDependencies({ retrieveKnowledgeFn });

    const result = await handleLeaveRequest({
      message: "Can I take annual leave from August 10 to August 12 under company policy?",
      aiContext,
      conversationMessages: [],
    }, dependencies);

    expect(result.status).toBe("eligibility");
    expect(retrieveKnowledgeFn).toHaveBeenCalledTimes(1);
    expect(retrieveKnowledgeFn.mock.calls[0][0].context.sourceType).toBe("company-policy");
  });

  it("creates an Annual draft and submits it to Pending after explicit confirmation", async () => {
    const dependencies = createDependencies();

    const result = await handleLeaveRequest({
      message: "Yes, create it.",
      aiContext,
      conversationMessages: [
        {
          role: "user",
          content: "Can I take annual leave from August 10 to August 12?",
        },
        {
          role: "assistant",
          content: "You appear eligible. Would you like me to create it?",
        },
      ],
    }, dependencies);

    expect(result.status).toBe("submitted");
    expect(result.action).toEqual({
      type: "leave_request",
      payload: {
        request_id: "req-1",
        status: "Pending",
      },
    });
    expect(result.result_card).toEqual({
      type: "leave_draft",
      request_id: "req-1",
      leave_type: "Annual",
      start_date: "2026-08-10",
      end_date: "2026-08-12",
      days_requested: 3,
      attachment_uploaded: false,
      actions: [],
    });
    expect(dependencies.createLeaveDraftFn).toHaveBeenCalledWith(aiContext, {
      leave_type: "Annual",
      start_date: "2026-08-10",
      end_date: "2026-08-12",
      reason: undefined,
    });
    expect(dependencies.submitLeaveDraftFn).toHaveBeenCalledWith(aiContext, "req-1");
  });

  it("creates and submits a valid Unpaid leave request", async () => {
    const dependencies = createDependencies();

    const result = await handleLeaveRequest({
      message: "Please create unpaid leave request from August 10 to August 12",
      aiContext,
      conversationMessages: [],
    }, dependencies);

    expect(result.status).toBe("submitted");
    expect(dependencies.createLeaveDraftFn).toHaveBeenCalledWith(aiContext, {
      leave_type: "Unpaid",
      start_date: "2026-08-10",
      end_date: "2026-08-12",
      reason: undefined,
    });
    expect(dependencies.submitLeaveDraftFn).toHaveBeenCalledTimes(1);
  });

  it("safely blocks Sick leave creation when chat has no attachment support", async () => {
    const dependencies = createDependencies();

    const result = await handleLeaveRequest({
      message: "Please create sick leave request from August 10 to August 12",
      aiContext,
      conversationMessages: [],
    }, dependencies);

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("LEAVE_ATTACHMENT_UNSUPPORTED");
    expect(dependencies.createLeaveDraftFn).not.toHaveBeenCalled();
    expect(dependencies.submitLeaveDraftFn).not.toHaveBeenCalled();
  });

  it("maps backend create validation errors safely", async () => {
    const backendError = new Error("Requested days exceed remaining balance");
    backendError.code = "insufficient_leave_balance";
    backendError.status = 422;
    const dependencies = createDependencies({
      createLeaveDraftFn: jest.fn().mockRejectedValue(backendError),
    });

    const result = await handleLeaveRequest({
      message: "Please create annual leave request from August 10 to August 20",
      aiContext,
      conversationMessages: [],
    }, dependencies);

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("insufficient_leave_balance");
    expect(result.message).toBe("You do not have enough leave balance for this request.");
    expect(dependencies.submitLeaveDraftFn).not.toHaveBeenCalled();
  });

  it("reports submit failure without calling the HR review endpoint", async () => {
    const backendError = new Error("Already submitted");
    backendError.code = "not_a_draft";
    backendError.status = 409;
    const submitLeaveDraftFn = jest.fn().mockRejectedValue(backendError);
    const dependencies = createDependencies({ submitLeaveDraftFn });

    const result = await handleLeaveRequest({
      message: "Please create annual leave request from August 10 to August 12",
      aiContext,
      conversationMessages: [],
    }, dependencies);

    expect(result.status).toBe("submit_failed");
    expect(result.action.payload).toEqual({
      request_id: "req-1",
      status: "Draft",
    });
    expect(submitLeaveDraftFn).toHaveBeenCalledWith(aiContext, "req-1");
  });

  it("rejects invalid past dates before calling the backend", async () => {
    const dependencies = createDependencies({
      baseDate: new Date("2026-08-12T00:00:00Z"),
    });

    const result = await handleLeaveRequest({
      message: "Please create annual leave request from August 10 to August 12",
      aiContext,
      conversationMessages: [],
    }, dependencies);

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("LEAVE_DATES_INVALID");
    expect(dependencies.createLeaveDraftFn).not.toHaveBeenCalled();
  });

  it("does not generate or send employee_id in backend payloads", async () => {
    const dependencies = createDependencies();

    await handleLeaveRequest({
      message: "Please create annual leave request from August 10 to August 12",
      aiContext,
      conversationMessages: [],
    }, dependencies);

    const payload = dependencies.createLeaveDraftFn.mock.calls[0][1];
    expect(payload).not.toHaveProperty("employee_id");
    expect(payload).not.toHaveProperty("employeeId");
    expect(payload).not.toHaveProperty("record_id");
  });

  it("accumulates leave fields across multiple conversational turns", async () => {
    const dependencies = createDependencies();

    const result = await handleLeaveRequest({
      message: "Yes, create it.",
      aiContext,
      conversationMessages: [
        {
          role: "user",
          content: "I want to take leave.",
        },
        {
          role: "assistant",
          content: "What type of leave would you like?",
          missing_fields: [{
            field_name: "leave_type",
            input_type: "dropdown",
            label: "Leave Type",
            options: ["Annual", "Sick", "Unpaid"],
          }],
        },
        {
          role: "user",
          content: "Annual.",
        },
        {
          role: "assistant",
          content: "What dates?",
          missing_fields: [
            { field_name: "start_date", input_type: "date", label: "Start Date", options: [] },
            { field_name: "end_date", input_type: "date", label: "End Date", options: [] },
          ],
        },
        {
          role: "user",
          content: "August 10 to August 12.",
        },
      ],
    }, dependencies);

    expect(result.status).toBe("submitted");
    expect(dependencies.createLeaveDraftFn).toHaveBeenCalledWith(aiContext, {
      leave_type: "Annual",
      start_date: "2026-08-10",
      end_date: "2026-08-12",
      reason: undefined,
    });
  });
});

