import { handleChat } from "../orchestrator/orchestrator.service.js";

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
    const { message, conversationId, context } = req.body;

    // Delegate to the clean service boundary, injecting conversationId into context
    const fullContext = { ...context, conversationId };
    const result = await handleChat({ message, conversationId, context: fullContext });

    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};
