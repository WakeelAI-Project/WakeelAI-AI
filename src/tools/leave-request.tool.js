import { z } from "zod";
import { logger } from "../shared/logger.js";
import { handleLeaveRequest } from "../services/leave-request.service.js";

export const leaveRequestInputSchema = z.object({
  message: z.string().describe("The user's leave request or leave eligibility message"),
});

const leaveRequestTool = {
  name: "leave_request",
  description: "Handles employee-facing leave balance, eligibility, draft creation, draft submission, and draft cancellation through the Wakeel backend.",
  inputSchema: leaveRequestInputSchema,

  /**
   * Executes the leave request tool.
   *
   * @param {string} message
   * @param {import("../contracts/index.js").AIContext} context
   * @returns {Promise<import("../contracts/index.js").SkillResult>}
   */
  async execute(message, context) {
    logger.info("[LeaveRequestTool] Executing leave request capability");

    const result = await handleLeaveRequest({
      message,
      aiContext: context,
    });

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

export default leaveRequestTool;

