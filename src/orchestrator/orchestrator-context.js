/**
 * @typedef {Object} OrchestratorContext
 * @property {string} message - Original user message.
 * @property {string} conversationId - The conversation identifier.
 * @property {import("../contracts/index.js").AIContext} userContext - Context about the user (role, company).
 * @property {Array<{role: string, content: string}>} conversationMessages - Previous scoped conversation turns.
 * @property {Object} intent - The intent analysis result.
 * @property {Object} gatheredData - Knowledge and company/employee context gathered based on intent.
 * @property {Array<Object>} capabilityResults - Results from executing required tools and skills.
 */

/**
 * Creates a new, empty orchestrator context.
 * 
 * @param {string} message
 * @param {string} conversationId
 * @param {import("../contracts/index.js").AIContext} userContext
 * @param {Array<{role: string, content: string}>} conversationMessages
 * @returns {OrchestratorContext}
 */
export const createOrchestratorContext = (message, conversationId, userContext, conversationMessages = []) => ({
  message,
  conversationId,
  userContext,
  conversationMessages,
  intent: null,
  gatheredData: {},
  capabilityResults: [],
});
