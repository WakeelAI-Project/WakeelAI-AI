import { handleChat } from "../orchestrator/orchestrator.service.js";
import * as chatHistoryService from "../services/chat-history.service.js";

/**
 * AI Chat Controller
 * Extracts validated request data and delegates to the orchestration service.
 * Does NOT contain AI business logic.
 *
 * API v8 canonical contract:
 *   Body: { message, context: { userId, companyId, role, conversationId }, language?, field_values? }
 *   M2M headers (from requireInternalAuth): X-User-Id, X-Company-Id, X-Role
 *
 * Security: The body.context identity is CROSS-CHECKED against the trusted M2M
 * headers to prevent a compromised or misconfigured upstream from accidentally
 * injecting a different identity into the payload. If the values differ, the
 * request is rejected with 403 to avoid acting on an inconsistent identity.
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
export const postChat = async (req, res, next) => {
  try {
    const { message, context, language, field_values } = req.body;
    // req.aiContext is populated by requireInternalAuth from trusted M2M headers
    const trustedHeaders = req.aiContext;

    console.log(`[AIChatController] Chat request received. message="${message}"`);
    console.log(
      "[AIChatController] Authenticated context received. " +
      `userId present=${Boolean(trustedHeaders?.userId)} ` +
      `companyId present=${Boolean(trustedHeaders?.companyId)} ` +
      `role present=${Boolean(trustedHeaders?.role)}`
    );
    console.log(
      "[AIChatController] Body context received. " +
      `userId present=${Boolean(context?.userId)} ` +
      `companyId present=${Boolean(context?.companyId)} ` +
      `conversationId present=${Boolean(context?.conversationId)}`
    );

    // Security: cross-check body.context identity against trusted M2M headers.
    // The .NET gateway attaches both the JSON context and the M2M headers from the
    // same authenticated identity. If they ever diverge, reject immediately.
    if (
      context.userId !== trustedHeaders.userId ||
      context.companyId !== trustedHeaders.companyId ||
      context.role !== trustedHeaders.role
    ) {
      return res.status(403).json({
        success: false,
        error: {
          code: "IDENTITY_CONTEXT_MISMATCH",
          message: "The request context identity does not match the authenticated service identity.",
        },
      });
    }

    // Canonical context: identity from trusted headers + conversationId from body.context
    const fullContext = {
      userId: trustedHeaders.userId,
      companyId: trustedHeaders.companyId,
      role: trustedHeaders.role,
      conversationId: context.conversationId,
      // Forward optional fields if provided (forward-compat for when .NET proxies them)
      ...(language !== undefined && { language }),
      ...(field_values !== undefined && { field_values }),
    };

    console.log(
      "[AIChatController] Forwarding trusted context to orchestrator. " +
      `companyId present=${Boolean(fullContext.companyId)} ` +
      `conversationId present=${Boolean(fullContext.conversationId)}`
    );

    const conversationId = context.conversationId;

    // 1. Ensure the conversation is new or belongs to the trusted user/company scope.
    await chatHistoryService.ensureConversation(conversationId, fullContext);

    // 2. Load previous scoped turns before orchestration so follow-ups like
    // "summarize it" can refer to the assistant's prior answer.
    const conversationMessages = await chatHistoryService.getRecentHistoryForContext(
      conversationId,
      fullContext
    );

    // 3. Execute orchestration with previous turns + current message.
    const result = await handleChat({
      message,
      conversationId,
      context: fullContext,
      conversationMessages,
    });

    // 4. Persist the current user message and assistant response.
    await chatHistoryService.persistUserMessage(conversationId, fullContext, message);
    await chatHistoryService.persistAssistantMessage(conversationId, fullContext, result);

    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};
