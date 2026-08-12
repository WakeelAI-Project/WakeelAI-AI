import { handleChat } from "../orchestrator/orchestrator.service.js";
import * as chatHistoryService from "../services/chat-history.service.js";

/**
 * AI Chat Controller
 * Extracts validated request data and delegates to the orchestration service.
 * Does NOT contain AI business logic.
 * 
 * @param {import("express").Request} req 
 * @param {import("express").Response} res 
 * @param {import("express").NextFunction} next 
 */
export const postChat = async (req, res, next) => {
  try {
    const { message, conversationId } = req.body;
    const context = req.aiContext;

    // Delegate to the clean service boundary, injecting conversationId into context
    const fullContext = { ...context, conversationId };
    
    // 1. Persist the user message before orchestration
    await chatHistoryService.persistUserMessage(conversationId, fullContext, message);

    // 2. Execute orchestration
    const result = await handleChat({ message, conversationId, context: fullContext });

    // 3. Persist the assistant message
    await chatHistoryService.persistAssistantMessage(conversationId, result);

    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};
