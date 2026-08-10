import { logger } from "../shared/logger.js";
import { config } from "../config/env.js";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { createOrchestratorContext } from "./orchestrator-context.js";
import { gatherContextBoundary, executeCapabilitiesBoundary } from "./dependency-boundaries.js";

// Initialize LLM for intent and final response
// Note: We use the API keys loaded from the environment/config
const llm = new ChatOpenAI({
  apiKey: config.LLM_API_KEY,
  modelName: config.LLM_MODEL,
  temperature: 0,
});

// Schema for structured intent detection
const IntentSchema = z.object({
  intent: z.enum([
    "calculation",
    "document_generation",
    "employee_question",
    "company_policy_question",
    "labor_law_question",
    "leave_request",
    "general_conversation"
  ]).describe("The core intent of the user's message."),
  requiresCapabilities: z.array(z.string()).describe("List of capability names required (e.g. 'calculation', 'leave_request_tool')."),
  requiresContext: z.array(z.enum(["employee", "company", "rag"])).describe("Data sources required to answer accurately.")
});

const intentLlm = llm.withStructuredOutput(IntentSchema, {
  name: "determine_intent"
});

/**
 * Determines intent using the configured LLM.
 * 
 * @param {string} message 
 * @returns {Promise<Object>}
 */
async function determineIntent(message) {
  try {
    const analysis = await intentLlm.invoke(`Analyze the following user message and determine their intent, required capabilities, and required context data sources.
    
User Message: "${message}"`);
    return analysis;
  } catch (error) {
    logger.error(`[Orchestrator] Failed to determine intent: ${error.message}`);
    // Fallback to general conversation if structured output fails
    return {
      intent: "general_conversation",
      requiresCapabilities: [],
      requiresContext: []
    };
  }
}

/**
 * Handles an AI chat request.
 * 
 * @param {Object} input
 * @param {string} input.message
 * @param {string} input.conversationId
 * @param {import("../contracts/index.js").AIContext} input.context
 * @returns {Promise<import("../contracts/index.js").ChatResponse>}
 */
export const handleChat = async ({ message, conversationId, context }) => {
  logger.info(`[Orchestrator] Starting orchestration for conversation: ${conversationId}`);

  try {
    // 1. Initialize Orchestration Context
    const orchContext = createOrchestratorContext(message, conversationId, context);

    // 2. Determine Intent & Required Capabilities
    orchContext.intent = await determineIntent(message);
    logger.info(`[Orchestrator] Intent determined: ${orchContext.intent.intent}`);

    // 3. Gather Required Context (Knowledge, Employee, Company)
    orchContext.gatheredData = await gatherContextBoundary(orchContext.intent.requiresContext, orchContext.userContext);

    // 4. Execute Capabilities (Skills / Tools)
    orchContext.capabilityResults = await executeCapabilitiesBoundary(orchContext.intent.requiresCapabilities, orchContext);

    // 5. Generate Final Response
    const finalPrompt = `
You are Wakeel AI, a helpful AI assistant. 
Answer the user's message based on their intent, gathered data context, and executed capabilities.
If capabilities return specific data (like a calculation result or policy), use that to answer the user.

User Message: "${orchContext.message}"
Detected Intent: ${orchContext.intent.intent}

Gathered Data Context:
${JSON.stringify(orchContext.gatheredData, null, 2)}

Capability Execution Results:
${JSON.stringify(orchContext.capabilityResults, null, 2)}

Respond with a clear and concise final answer.
`;

    const finalResponse = await llm.invoke(finalPrompt);

    logger.info(`[Orchestrator] Finished orchestration for conversation: ${conversationId}`);

    // Return using the shared ChatResponse shape
    return {
      conversationId: orchContext.conversationId,
      message: finalResponse.content,
      type: "text",
      sources: [], // Will be populated in Task 3.4
      actions: []  // Will be populated in Task 3.9
    };
  } catch (error) {
    logger.error(`[Orchestrator] Fatal error during orchestration: ${error.message}`);
    
    // Controlled error response without leaking internals
    return {
      conversationId,
      message: "An internal error occurred while processing your request.",
      type: "text",
      sources: [],
      actions: []
    };
  }
};
