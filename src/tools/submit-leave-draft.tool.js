import { z } from "zod";
import { logger } from "../shared/logger.js";
import { handleSubmitLeaveDraft } from "../services/leave-request.service.js";

export const submitLeaveDraftInputSchema = z.object({
  request_id: z.string().optional().describe("The ID of the leave request draft to submit."),
});

const submitLeaveDraftTool = {
  name: "submit_leave_draft",
  description: "Submits an existing leave request draft for HR approval.",
  inputSchema: submitLeaveDraftInputSchema,

  /**
   * Executes the leave draft submission tool.
   *
   * @param {string} message
   * @param {import("../contracts/index.js").AIContext} context
   * @param {Object} args
   * @returns {Promise<import("../contracts/index.js").SkillResult>}
   */
  async execute(message, context, args = {}) {
    logger.info("[SubmitLeaveDraftTool] Executing submit leave draft capability");

    // Role gate: leave tools are restricted to Employee and HR_Manager only
    const ALLOWED_ROLES = ["Employee", "HR_Manager"];
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
        message: "Leave request actions are available to employees and HR managers only.",
        sources: [],
        action: null,
      };
    }

    // Attempt to parse request_id from message if not provided in args (fallback)
    let requestId = args.request_id;
    if (!requestId) {
        const match = message.match(/\b(req-[a-zA-Z0-9-]+)\b/i);
        if (match) requestId = match[1];
    }

    const result = await handleSubmitLeaveDraft(context, { ...args, request_id: requestId });

    return {
      success: result.success,
      data: {
        type: "leave_request",
        status: result.status,
        leave_request: result.leave_request,
        error: result.error,
      },
      message: result.message,
      sources: result.sources || [],
      action: result.action || null,
    };
  },
};

export default submitLeaveDraftTool;
