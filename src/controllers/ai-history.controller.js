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

/**
 * AI Conversations Controller
 * Retrieves paginated conversations list for a given user.
 *
 * @param {import("express").Request} req 
 * @param {import("express").Response} res 
 * @param {import("express").NextFunction} next 
 */
export const getConversations = async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const context = req.aiContext;

    const conversations = await chatHistoryService.getUserConversations(
      context,
      page,
      limit
    );

    return res.status(200).json(conversations);
  } catch (error) {
    next(error);
  }
};

/**
 * AI Delete Conversation Controller
 * Deletes a conversation and its history.
 *
 * @param {import("express").Request} req 
 * @param {import("express").Response} res 
 * @param {import("express").NextFunction} next 
 */
export const deleteConversation = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const context = req.aiContext;

    await chatHistoryService.deleteConversation(conversationId, context);

    return res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
};
