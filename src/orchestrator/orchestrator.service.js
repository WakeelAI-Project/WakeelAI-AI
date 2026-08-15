import { logger } from "../shared/logger.js";
import { config, llmConfig } from "../config/env.js";
import { ITILanguageModel } from "../llm/iti-adapter.js";
import { z } from "zod";
import { ChatResponseSchema } from "../contracts/index.js";
import { createOrchestratorContext } from "./orchestrator-context.js";
import { gatherContextBoundary, executeCapabilitiesBoundary } from "./dependency-boundaries.js";

// Initialize LLM for intent and final response
// Note: We use the API keys loaded from the environment/config
const llm = new ITILanguageModel({
  ...llmConfig,
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
    "create_leave_draft",
    "submit_leave_draft",
    "cancel_leave_draft",
    "general_conversation"
  ]).describe("The core intent of the user's message."),
  requiresCapabilities: z.array(z.string()).describe("List of capability names required (e.g. 'calculation', 'create_leave_draft')."),
  requiresContext: z.array(z.enum(["employee", "company", "rag"])).describe("Data sources required to answer accurately."),
  arguments: z.record(z.string(), z.any()).optional().describe("Structured arguments for the required capabilities if applicable (e.g. leave_type, start_date).")
});

const intentLlm = llm.withStructuredOutput(IntentSchema, {
  name: "determine_intent"
});

const DOCUMENT_GENERATION_CAPABILITY = "document_generation";
const CREATE_LEAVE_CAPABILITY = "create_leave_draft";
const SUBMIT_LEAVE_CAPABILITY = "submit_leave_draft";
const CANCEL_LEAVE_CAPABILITY = "cancel_leave_draft";
const LEGACY_LEAVE_REQUEST_CAPABILITY = "leave_request_tool";
const LEGACY_LEAVE_REQUEST = "leave_request";
const MAX_HISTORY_CONTEXT_CHARS = 18000;
const MAX_INTENT_HISTORY_CHARS = 4000;

const normalizeConversationMessages = (messages = [], maxChars = MAX_HISTORY_CONTEXT_CHARS) => {
  const normalizedMessages = messages
    .filter((message) => (
      (message?.role === "user" || message?.role === "assistant") &&
      typeof message?.content === "string" &&
      message.content.trim()
    ))
    .map((message) => ({
      role: message.role === "assistant" ? "Assistant" : "User",
      content: message.content.trim(),
    }));

  if (!normalizedMessages.length) {
    return [];
  }

  const entries = [];
  let remainingChars = maxChars;

  for (let index = normalizedMessages.length - 1; index >= 0; index -= 1) {
    const message = normalizedMessages[index];
    const entry = message.content;
    const separatorLength = entries.length ? 2 : 0;

    if (entry.length + separatorLength <= remainingChars) {
      entries.unshift({
        role: message.role === "Assistant" ? "assistant" : "user",
        content: message.content,
      });
      remainingChars -= entry.length + separatorLength;
      continue;
    }

    if (remainingChars > 120) {
      entries.unshift({
        role: message.role === "Assistant" ? "assistant" : "user",
        content: `${entry.slice(0, remainingChars - 34)}\n[Message truncated for context]`,
      });
    }

    break;
  }

  return entries;
};

const formatConversationHistoryForDebug = (messages = []) => (
  messages.length
    ? messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n")
    : "No previous conversation messages."
);

const buildIntentMessages = (message, conversationMessages = []) => [
  {
    role: "system",
    content: `Analyze the current user message and determine their intent, required capabilities, and required context data sources.
Use the prior conversation messages to resolve context-dependent requests such as summaries, translations, shorter rewrites, continuations, and follow-up questions.
Return only the structured JSON required by the schema.`,
  },
  ...normalizeConversationMessages(conversationMessages, MAX_INTENT_HISTORY_CHARS),
  {
    role: "user",
    content: message,
  },
];

const buildFinalMessages = ({ message, conversationMessages = [], intent, gatheredData, capabilityResults }) => [
  {
    role: "system",
    content: `You are Wakeel AI, a helpful AI assistant.
Answer the current user message using the prior conversation messages plus the gathered data and capability results below.
If the current user asks to summarize, translate, shorten, explain, or continue prior content, apply the request to the relevant previous assistant response.
Do not claim there is no text to summarize when the prior messages contain relevant assistant content.
If capabilities return specific data, use it when it is relevant, but do not let an irrelevant capability result override a clear request about the previous assistant answer.

Detected Intent: ${intent?.intent || "unknown"}

Gathered Data Context:
${JSON.stringify(gatheredData || {}, null, 2)}

Capability Execution Results:
${JSON.stringify(capabilityResults || [], null, 2)}`,
  },
  ...normalizeConversationMessages(conversationMessages, MAX_HISTORY_CONTEXT_CHARS),
  {
    role: "user",
    content: message,
  },
];

const normalizeIntent = (intent) => {
  const requiresCapabilities = Array.isArray(intent?.requiresCapabilities)
    ? intent.requiresCapabilities.map((capability) => {
        if (capability === LEGACY_LEAVE_REQUEST_CAPABILITY || capability === LEGACY_LEAVE_REQUEST) {
          return CREATE_LEAVE_CAPABILITY; // Default fallback for old prompts
        }
        return capability;
      })
    : [];

  if (
    intent?.intent === DOCUMENT_GENERATION_CAPABILITY
    && !requiresCapabilities.includes(DOCUMENT_GENERATION_CAPABILITY)
  ) {
    requiresCapabilities.push(DOCUMENT_GENERATION_CAPABILITY);
  }

  if (
    intent?.intent === CREATE_LEAVE_CAPABILITY
    && !requiresCapabilities.includes(CREATE_LEAVE_CAPABILITY)
  ) {
    requiresCapabilities.push(CREATE_LEAVE_CAPABILITY);
  }

  if (
    intent?.intent === SUBMIT_LEAVE_CAPABILITY
    && !requiresCapabilities.includes(SUBMIT_LEAVE_CAPABILITY)
  ) {
    requiresCapabilities.push(SUBMIT_LEAVE_CAPABILITY);
  }

  if (
    intent?.intent === CANCEL_LEAVE_CAPABILITY
    && !requiresCapabilities.includes(CANCEL_LEAVE_CAPABILITY)
  ) {
    requiresCapabilities.push(CANCEL_LEAVE_CAPABILITY);
  }

  return {
    ...intent,
    requiresCapabilities: [...new Set(requiresCapabilities)],
    requiresContext: Array.isArray(intent?.requiresContext) ? intent.requiresContext : [],
  };
};

const getDocumentGenerationSkillResult = (capabilityResults) => {
  const result = capabilityResults.find((candidate) => (
    candidate.capability === DOCUMENT_GENERATION_CAPABILITY
    && candidate.status === "success"
    && candidate.data?.data?.type === DOCUMENT_GENERATION_CAPABILITY
  ));

  return result?.data || null;
};

const buildDocumentGenerationResponse = (conversationId, skillResult) => {
  const payload = skillResult.data || {};
  const response = {
    conversationId,
    message: skillResult.message || "I could not complete the document generation request.",
    type: payload.result_card ? "action" : "text",
    sources: skillResult.sources || [],
    actions: skillResult.action ? [skillResult.action] : [],
  };

  if (payload.missing_fields) {
    response.missing_fields = payload.missing_fields;
  }

  if (payload.result_card) {
    response.result_card = payload.result_card;
  }

  return ChatResponseSchema.parse(response);
};

const getLeaveRequestToolResult = (capabilityResults) => {
  const result = capabilityResults.find((candidate) => (
    (candidate.capability === CREATE_LEAVE_CAPABILITY || 
     candidate.capability === SUBMIT_LEAVE_CAPABILITY || 
     candidate.capability === CANCEL_LEAVE_CAPABILITY)
    && candidate.status === "success"
    && candidate.data?.data?.type === "leave_request"
  ));

  return result?.data || null;
};

const buildLeaveRequestResponse = (conversationId, toolResult) => {
  const payload = toolResult.data || {};
  const response = {
    conversationId,
    message: toolResult.message || "I could not complete the leave request.",
    type: payload.result_card || toolResult.action ? "action" : "text",
    sources: toolResult.sources || [],
    actions: toolResult.action ? [toolResult.action] : [],
  };

  if (payload.missing_fields) {
    response.missing_fields = payload.missing_fields;
  }

  if (payload.result_card) {
    response.result_card = payload.result_card;
  }

  return ChatResponseSchema.parse(response);
};

/**
 * Determines intent using the configured LLM.
 * 
 * @param {string} message 
 * @returns {Promise<Object>}
 */
async function determineIntent(message, conversationMessages = []) {
  try {
    const analysis = await intentLlm.invoke(buildIntentMessages(message, conversationMessages));
    return normalizeIntent(analysis);
  } catch (error) {
    logger.error(`[Orchestrator] Failed to determine intent: ${error.message}`);
    // Fallback to general conversation if structured output fails
    return normalizeIntent({
      intent: "general_conversation",
      requiresCapabilities: [],
      requiresContext: []
    });
  }
}

/**
 * Handles an AI chat request.
 * 
 * @param {Object} input
 * @param {string} input.message
 * @param {string} input.conversationId
 * @param {import("../contracts/index.js").AIContext} input.context
 * @param {Array<{role: string, content: string}>} [input.conversationMessages]
 * @returns {Promise<import("../contracts/index.js").ChatResponse>}
 */
export const handleChat = async ({ message, conversationId, context, conversationMessages = [] }) => {
  logger.info(`[Orchestrator] Starting orchestration for conversation: ${conversationId}`);

  try {
    // 1. Initialize Orchestration Context
    const orchContext = createOrchestratorContext(message, conversationId, context, conversationMessages);

    // 2. Determine Intent & Required Capabilities
    orchContext.intent = await determineIntent(message, orchContext.conversationMessages);
    logger.info(`[Orchestrator] Intent determined: ${orchContext.intent.intent}`);

    // 3. Gather Required Context (Knowledge, Employee, Company)
    orchContext.gatheredData = await gatherContextBoundary(orchContext.intent.requiresContext, orchContext.userContext);

    // 4. Execute Capabilities (Skills / Tools)
    orchContext.capabilityResults = await executeCapabilitiesBoundary(orchContext.intent.requiresCapabilities, orchContext);

    const documentGenerationResult = getDocumentGenerationSkillResult(orchContext.capabilityResults);
    if (documentGenerationResult) {
      logger.info(`[Orchestrator] Returning structured document generation response for conversation: ${conversationId}`);
      return buildDocumentGenerationResponse(orchContext.conversationId, documentGenerationResult);
    }

    const leaveRequestResult = getLeaveRequestToolResult(orchContext.capabilityResults);
    if (leaveRequestResult) {
      logger.info(`[Orchestrator] Returning structured leave request response for conversation: ${conversationId}`);
      return buildLeaveRequestResponse(orchContext.conversationId, leaveRequestResult);
    }

    // 5. Generate Final Response
    const finalMessages = buildFinalMessages({
      message: orchContext.message,
      conversationMessages: orchContext.conversationMessages,
      intent: orchContext.intent,
      gatheredData: orchContext.gatheredData,
      capabilityResults: orchContext.capabilityResults,
    });

    if (process.env.NODE_ENV === "test" || process.env.WAKEEL_DEBUG_LLM_CONTEXT === "true") {
      logger.debug("[Orchestrator] Final LLM context summary", {
        conversationId,
        historyLength: orchContext.conversationMessages.length,
        historyRoles: orchContext.conversationMessages.map((item) => item.role),
        currentUserMessage: orchContext.message,
        historyPreview: formatConversationHistoryForDebug(
          normalizeConversationMessages(orchContext.conversationMessages, 2000)
        ),
      });
    }

    const finalResponse = await llm.invoke(finalMessages);

    logger.info(`[Orchestrator] Finished orchestration for conversation: ${conversationId}`);

    const allSources = [];
    if (Array.isArray(orchContext.capabilityResults)) {
      orchContext.capabilityResults.forEach((res) => {
        if (res.status === "success" && res.data?.sources && Array.isArray(res.data.sources)) {
          allSources.push(...res.data.sources);
        }
      });
    }

    // Return using the shared ChatResponse shape
    return {
      conversationId: orchContext.conversationId,
      message: finalResponse.content,
      type: "text",
      sources: allSources,
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
