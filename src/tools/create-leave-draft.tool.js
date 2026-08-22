import { z } from "zod";
import { logger } from "../shared/logger.js";
import { LEAVE_TYPES, normalizeLeaveType } from "../domain/leave-types.js";
import { handleCreateLeaveDraft } from "../services/leave-request.service.js";

const LeaveTypeInputSchema = z.preprocess(
  (value) => normalizeLeaveType(value) || value,
  z.enum(LEAVE_TYPES).optional(),
);

export const createLeaveDraftInputSchema = z.object({
  leave_type: LeaveTypeInputSchema.describe("The type of leave requested."),
  start_date: z.string().optional().describe("The start date of the leave in YYYY-MM-DD format."),
  end_date: z.string().optional().describe("The end date of the leave in YYYY-MM-DD format."),
  reason: z.string().optional().describe("The reason for the leave."),
  attachment_url: z.string().optional().describe("The URL of the uploaded medical report, passed from field_values.attachment_url"),
});

const createLeaveDraftTool = {
  name: "create_leave_draft",
  description: "Creates a draft leave request. Do not use for submitting or cancelling.",
  inputSchema: createLeaveDraftInputSchema,

  /**
   * Executes the leave draft creation tool.
   *
   * @param {string} message
   * @param {import("../contracts/index.js").AIContext} context
   * @param {Object} args
   * @returns {Promise<import("../contracts/index.js").SkillResult>}
   */
  async execute(message, context, args = {}) {
    logger.info("[CreateLeaveDraftTool] Executing create leave draft capability");

    // Role gate: leave tools are restricted to Employee only
    const ALLOWED_ROLES = ["Employee"];
    if (!ALLOWED_ROLES.includes(context.role)) {
      return {
        success: false,
        data: {
          type: "leave_request",
          status: "error",
          error: {
            code: "FORBIDDEN_LEAVE_ACTION",
            status: 403,
          },
        },
        message:
          "Leave requests can only be created and managed by employees for themselves. As an HR Manager you can review and approve requests, but you cannot submit a leave request through the assistant.",
        sources: [],
        action: null,
      };
    }

    const result = await handleCreateLeaveDraft(context, args);

    return {
      success: result.success,
      data: {
        type: "leave_request",
        status: result.status,
        missing_fields: result.missing_fields,
        result_card: result.result_card,
        leave_request: result.leave_request,
        error: result.error,
        employee_context_used: result.employee_context_used,
      },
      message: result.message,
      sources: result.sources || [],
      action: result.action || null,
    };
  },
};

export default createLeaveDraftTool;
