import { z } from "zod";
import { logger } from "../shared/logger.js";
import { handleCreateLeaveDraft } from "../services/leave-request.service.js";

export const createLeaveDraftInputSchema = z.object({
  leave_type: z.enum(["Annual", "Sick", "Unpaid"]).optional().describe("The type of leave requested."),
  start_date: z.string().optional().describe("The start date of the leave in YYYY-MM-DD format."),
  end_date: z.string().optional().describe("The end date of the leave in YYYY-MM-DD format."),
  reason: z.string().optional().describe("The reason for the leave."),
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
