import crypto from "crypto";
import { logger } from "../shared/logger.js";
import * as repository from "../data-access/chat-history.repository.js";

const DEFAULT_CONTEXT_HISTORY_LIMIT = 20;

function createConversationNotFoundError() {
  const error = new Error("Conversation not found");
  error.status = 404;
  error.code = "CONVERSATION_NOT_FOUND";
  return error;
}

function isConversationInContext(conversation, context) {
  return (
    conversation?.userId === context.userId &&
    conversation?.companyId === context.companyId
  );
}

/**
 * Ensures a conversation exists and belongs to the trusted user/company scope.
 * Creates the conversation for a new .NET-minted conversationId.
 *
 * @param {string} conversationId
 * @param {import("../contracts/index.js").AIContext} context
 * @returns {Promise<Object>}
 */
export async function ensureConversation(conversationId, context) {
  const { userId, companyId, role, targetEmployeeId, targetEmployeeName } = context;

  const conversation = await repository.upsertConversation({
    conversationId,
    userId,
    companyId,
    role,
    targetEmployeeId,
    targetEmployeeName,
  });

  if (!isConversationInContext(conversation, context)) {
    throw createConversationNotFoundError();
  }

  return conversation;
}

/**
 * Persists a user message, creating or reusing a conversation.
 *
 * @param {string} conversationId
 * @param {import("../contracts/index.js").AIContext} context
 * @param {string} messageContent
 */
export async function persistUserMessage(conversationId, context, messageContent) {
  try {
    const { userId, companyId } = context;

    // 1. Ensure conversation exists and ownership is recorded
    await ensureConversation(conversationId, context);

    // 2. Persist user message
    const messageId = crypto.randomUUID();
    await repository.saveMessage({
      messageId,
      conversationId,
      userId,
      companyId,
      role: "user",
      content: messageContent,
      field_values: context.field_values || null,
    });

    // 3. Set conversation title from the first message (if not already set)
    // Derive a reasonable title by truncating to 60 characters
    const derivedTitle = messageContent.length > 60 
      ? messageContent.substring(0, 57) + "..."
      : messageContent;
    await repository.setConversationTitleIfNotExists(conversationId, userId, companyId, derivedTitle);
  } catch (error) {
    if (error.code === "CONVERSATION_NOT_FOUND") {
      throw error;
    }

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
 * @param {import("../contracts/index.js").AIContext} context
 * @param {import("../contracts/index.js").ChatResponse} responseData
 */
export async function persistAssistantMessage(conversationId, context, responseData) {
  try {
    const { userId, companyId } = context;
    const messageId = crypto.randomUUID();
    await repository.saveMessage({
      messageId,
      conversationId,
      userId,
      companyId,
      role: "assistant",
      content: responseData.message,
      type: responseData.type,
      sources: responseData.sources,
      actions: responseData.actions,
      missing_fields: responseData.missing_fields || [],
      result_card: responseData.result_card || null,
    });
  } catch (error) {
    if (error.code === "CONVERSATION_NOT_FOUND") {
      throw error;
    }

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
    throw createConversationNotFoundError();
  }

  // 2. Enforce limits
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const safePage = Math.max(1, page);

  // 3. Retrieve messages
  const { messages, total } = await repository.getMessages(conversationId, userId, companyId, safePage, safeLimit);

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
    targetEmployeeId: conversation.targetEmployeeId || null,
    targetEmployeeName: conversation.targetEmployeeName || null,
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
 * Retrieves recent tenant-scoped history for LLM context.
 *
 * @param {string} conversationId
 * @param {import("../contracts/index.js").AIContext} context
 * @param {number} limit
 * @returns {Promise<Array<{role: string, content: string, missing_fields: Array, actions: Array, result_card: Object|null, createdAt: Date}>>}
 */
export async function getRecentHistoryForContext(
  conversationId,
  context,
  limit = DEFAULT_CONTEXT_HISTORY_LIMIT
) {
  const { userId, companyId } = context;

  const conversation = await repository.findConversation(conversationId, userId, companyId);

  if (!conversation) {
    return [];
  }

  const messages = await repository.getRecentMessages(conversationId, userId, companyId, limit);

  return messages.map((msg) => ({
    role: msg.role,
    content: msg.content,
    missing_fields: msg.missing_fields || [],
    field_values: msg.field_values || null,
    // actions carry the leave request_id + status, which is how a later
    // "ok send it" turn resolves which draft the user means, and how an
    // already-submitted/cancelled draft is excluded from that resolution.
    actions: msg.actions || [],
    result_card: msg.result_card || null,
    createdAt: msg.createdAt,
  }));
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

  // 3. Format response and backfill missing titles
  const formattedConversations = await Promise.all(conversations.map(async conv => {
    let title = conv.title;
    
    if (!title) {
      const { messages } = await repository.getMessages(conv.conversationId, userId, companyId, 1, 1);
      if (messages.length > 0 && messages[0].role === 'user') {
        const content = messages[0].content;
        title = content.length > 60 ? content.substring(0, 57) + "..." : content;
        
        // Optimistically backfill the title in the database
        const backfillPromise = repository.setConversationTitleIfNotExists(conv.conversationId, userId, companyId, title);
        if (backfillPromise && typeof backfillPromise.catch === 'function') {
          backfillPromise.catch(e => {
            logger.warn(`Failed to backfill title for conversation ${conv.conversationId}: ${e.message}`);
          });
        }
      }
    }
    return {
      conversationId: conv.conversationId,
      title: title || "New conversation",
      role: conv.role,
      targetEmployeeId: conv.targetEmployeeId,
      targetEmployeeName: conv.targetEmployeeName,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    };
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

/**
 * Deletes a conversation for a user.
 * Enforces tenant isolation.
 *
 * @param {string} conversationId
 * @param {import("../contracts/index.js").AIContext} context
 * @returns {Promise<boolean>}
 */
export async function deleteConversation(conversationId, context) {
  const { userId, companyId } = context;
  
  // deleteConversation repository method inherently scopes to userId and companyId
  const deleted = await repository.deleteConversation(conversationId, userId, companyId);
  
  if (!deleted) {
    throw createConversationNotFoundError();
  }
  
  return true;
}
