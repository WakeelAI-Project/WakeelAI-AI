import crypto from "crypto";
import { logger } from "../shared/logger.js";
import * as repository from "../data-access/chat-history.repository.js";

/**
 * Persists a user message, creating or reusing a conversation.
 *
 * @param {string} conversationId
 * @param {import("../contracts/index.js").AIContext} context
 * @param {string} messageContent
 */
export async function persistUserMessage(conversationId, context, messageContent) {
  try {
    const { userId, companyId, role } = context;

    // 1. Ensure conversation exists and ownership is recorded
    await repository.upsertConversation({
      conversationId,
      userId,
      companyId,
      role,
    });

    // 2. Persist user message
    const messageId = crypto.randomUUID();
    await repository.saveMessage({
      messageId,
      conversationId,
      role: "user",
      content: messageContent,
    });
  } catch (error) {
    logger.error(`[ChatHistoryService] Failed to persist user message: ${error.message}`);
    // Non-blocking: We log and swallow the error so AI orchestration can still proceed
    // if persistence fails, or we could throw. Based on standard practices, history 
    // failure shouldn't break the actual AI response unless strictly required.
    // For safety, let's throw so the controller handles it via error middleware.
    throw new Error("Failed to persist user message.");
  }
}

/**
 * Persists an assistant message to an existing conversation.
 *
 * @param {string} conversationId
 * @param {import("../contracts/index.js").ChatResponse} responseData
 */
export async function persistAssistantMessage(conversationId, responseData) {
  try {
    const messageId = crypto.randomUUID();
    await repository.saveMessage({
      messageId,
      conversationId,
      role: "assistant",
      content: responseData.message,
      type: responseData.type,
      sources: responseData.sources,
      actions: responseData.actions,
      missing_fields: responseData.missing_fields || [],
      result_card: responseData.result_card || null,
    });
  } catch (error) {
    logger.error(`[ChatHistoryService] Failed to persist assistant message: ${error.message}`);
    throw new Error("Failed to persist assistant message.");
  }
}

/**
 * Retrieves paginated chat history, strictly enforcing tenant/user isolation.
 *
 * @param {string} conversationId
 * @param {import("../contracts/index.js").AIContext} context
 * @param {number} page
 * @param {number} limit
 * @returns {Promise<Object>}
 */
export async function getHistory(conversationId, context, page = 1, limit = 20) {
  const { userId, companyId } = context;

  // 1. Verify ownership (tenant isolation)
  const conversation = await repository.findConversation(conversationId, userId, companyId);
  
  if (!conversation) {
    // Return a 404-like error structure recognized by the error handler,
    // or just a custom error that maps to 404.
    const error = new Error("Conversation not found");
    error.status = 404;
    error.code = "CONVERSATION_NOT_FOUND";
    throw error;
  }

  // 2. Enforce limits
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const safePage = Math.max(1, page);

  // 3. Retrieve messages
  const { messages, total } = await repository.getMessages(conversationId, safePage, safeLimit);

  // 4. Format response
  const formattedMessages = messages.map(msg => ({
    messageId: msg.messageId,
    role: msg.role,
    content: msg.content,
    type: msg.type,
    sources: msg.sources || [],
    actions: msg.actions || [],
    missing_fields: msg.missing_fields || [],
    result_card: msg.result_card || null,
    createdAt: msg.createdAt,
  }));

  return {
    conversationId,
    messages: formattedMessages,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      hasNextPage: safePage * safeLimit < total,
    }
  };
}

/**
 * Retrieves paginated conversations for a user, enforcing tenant/user isolation.
 *
 * @param {import("../contracts/index.js").AIContext} context
 * @param {number} page
 * @param {number} limit
 * @returns {Promise<Object>}
 */
export async function getUserConversations(context, page = 1, limit = 20) {
  const { userId, companyId } = context;

  // 1. Enforce limits
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const safePage = Math.max(1, page);

  // 2. Retrieve conversations strictly isolated to userId and companyId
  const { conversations, total } = await repository.getConversations(userId, companyId, safePage, safeLimit);

  // 3. Format response
  const formattedConversations = conversations.map(conv => ({
    conversationId: conv.conversationId,
    role: conv.role,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
  }));

  return {
    conversations: formattedConversations,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      hasNextPage: safePage * safeLimit < total,
    }
  };
}
