import * as chatHistoryService from "../services/chat-history.service.js";

/**
 * AI Chat History Controller
 * Retrieves paginated chat history for a given conversation.
 * Extracts context and query parameters, and delegates to the service.
 * 
 * @param {import("express").Request} req 
 * @param {import("express").Response} res 
 * @param {import("express").NextFunction} next 
 */
export const getHistory = async (req, res, next) => {
  try {
    const { conversationId, page, limit } = req.query;
    const context = req.aiContext;

    const history = await chatHistoryService.getHistory(
      conversationId,
      context,
      page,
      limit
    );

    return res.status(200).json(history);
  } catch (error) {
    next(error);
  }
};
