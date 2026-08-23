import { z } from "zod";
import { logger } from "../shared/logger.js";
import { handleCancelLeaveDraft } from "../services/leave-request.service.js";
import { extractRequestIdFromText } from "../orchestrator/leave-draft-context.js";

export const cancelLeaveDraftInputSchema = z.object({
  request_id: z.string().optional().describe("The ID of the leave request draft to cancel."),
});

const cancelLeaveDraftTool = {
  name: "cancel_leave_draft",
  description: "Cancels an existing leave request draft.",
  inputSchema: cancelLeaveDraftInputSchema,

  /**
   * Executes the leave draft cancellation tool.
   *
   * @param {string} message
   * @param {import("../contracts/index.js").AIContext} context
   * @param {Object} args
   * @returns {Promise<import("../contracts/index.js").SkillResult>}
   */
  async execute(message, context, args = {}) {
    logger.info("[CancelLeaveDraftTool] Executing cancel leave draft capability");

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

    // Secondary fallback: a request id typed straight into the message. Real ids
    // are backend GUIDs (Guid.NewGuid()), never a "req-" prefix. The primary
    // resolution happens deterministically in orchestrator/leave-draft-context.js.
    const requestId = args.request_id || extractRequestIdFromText(message) || undefined;

    const result = await handleCancelLeaveDraft(context, { ...args, request_id: requestId });

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

export default cancelLeaveDraftTool;
