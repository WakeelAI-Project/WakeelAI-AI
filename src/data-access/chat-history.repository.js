import { Conversation } from "./conversation.model.js";
import { Message } from "./message.model.js";

/**
 * Ensures a conversation exists for the given ID and context.
 * Upserts the conversation if it doesn't exist.
 *
 * @param {Object} data
 * @param {string} data.conversationId
 * @param {string} data.userId
 * @param {string} data.companyId
 * @param {string} data.role
 * @returns {Promise<Object>}
 */
export async function upsertConversation({ conversationId, userId, companyId, role }) {
  return await Conversation.findOneAndUpdate(
    { conversationId },
    { $setOnInsert: { conversationId, userId, companyId, role } },
    { upsert: true, new: true, lean: true }
  );
}

/**
 * Finds a conversation by ID, strictly scoping to userId and companyId for tenant isolation.
 *
 * @param {string} conversationId
 * @param {string} userId
 * @param {string} companyId
 * @returns {Promise<Object|null>}
 */
export async function findConversation(conversationId, userId, companyId) {
  return await Conversation.findOne({ conversationId, userId, companyId }).lean();
}

/**
 * Saves a new message.
 *
 * @param {Object} messageData
 * @returns {Promise<Object>}
 */
export async function saveMessage(messageData) {
  const message = new Message(messageData);
  return await message.save();
}

/**
 * Retrieves paginated messages for a conversation, ordered chronologically.
 *
 * @param {string} conversationId
 * @param {string} userId
 * @param {string} companyId
 * @param {number} page
 * @param {number} limit
 * @returns {Promise<{ messages: Array, total: number }>}
 */
export async function getMessages(conversationId, userId, companyId, page, limit) {
  const skip = (page - 1) * limit;
  const query = { conversationId, userId, companyId };

  const [messages, total] = await Promise.all([
    Message.find(query)
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Message.countDocuments(query),
  ]);

  return { messages, total };
}

/**
 * Retrieves the most recent tenant-scoped messages for LLM context.
 *
 * @param {string} conversationId
 * @param {string} userId
 * @param {string} companyId
 * @param {number} limit
 * @returns {Promise<Array>}
 */
export async function getRecentMessages(conversationId, userId, companyId, limit) {
  const safeLimit = Math.min(Math.max(1, limit), 50);

  const messages = await Message.find({ conversationId, userId, companyId })
    .sort({ createdAt: -1 })
    .limit(safeLimit)
    .lean();

  return messages.reverse();
}

/**
 * Retrieves paginated conversations for a user within a company, ordered chronologically (newest first).
 *
 * @param {string} userId
 * @param {string} companyId
 * @param {number} page
 * @param {number} limit
 * @returns {Promise<{ conversations: Array, total: number }>}
 */
export async function getConversations(userId, companyId, page, limit) {
  const skip = (page - 1) * limit;

  const [conversations, total] = await Promise.all([
    Conversation.find({ userId, companyId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Conversation.countDocuments({ userId, companyId }),
  ]);

  return { conversations, total };
}
