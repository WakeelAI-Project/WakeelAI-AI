/**
 * @typedef {Object} OrchestratorContext
 * @property {string} message - Original user message.
 * @property {string} conversationId - The conversation identifier.
 * @property {import("../contracts/index.js").AIContext} userContext - Context about the user (role, company).
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
 * @returns {OrchestratorContext}
 */
export const createOrchestratorContext = (message, conversationId, userContext) => ({
  message,
  conversationId,
  userContext,
  intent: null,
  gatheredData: {},
  capabilityResults: [],
});
