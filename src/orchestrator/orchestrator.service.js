import { logger } from "../shared/logger.js";
import { config, llmConfig } from "../config/env.js";
import { createLLM } from "../llm/llm-provider.js";
import { z } from "zod";
import { ChatResponseSchema } from "../contracts/index.js";
import { createOrchestratorContext } from "./orchestrator-context.js";
import {
  gatherContextBoundary,
  executeCapabilitiesBoundary,
} from "./dependency-boundaries.js";

// Initialize LLM for intent and final response
// Note: We use the API keys loaded from the environment/config
const llm = createLLM({
  ...llmConfig,
  temperature: 0,
});

// Schema for structured intent detection
const IntentSchema = z.object({
  intent: z
    .enum([
      "calculation",
      "document_generation",
      "employee_question",
      "company_question",
      "company_policy_question",
      "labor_law_question",
      "create_leave_draft",
      "submit_leave_draft",
      "cancel_leave_draft",
      "general_conversation",
    ])
    .describe("The core intent of the user's message."),
  requiresCapabilities: z
    .array(z.string())
    .describe(
      "List of capability names required (e.g. 'calculation', 'create_leave_draft').",
    ),
  requiresContext: z
    .array(z.enum(["employee", "company", "rag"]))
    .describe("Data sources required to answer accurately."),
  arguments: z
    .record(z.string(), z.any())
    .optional()
    .describe(
      "Structured arguments for the required capabilities if applicable (e.g. leave_type, start_date).",
    ),
});

const intentLlm = llm.withStructuredOutput(IntentSchema, {
  name: "determine_intent",
});

const DOCUMENT_GENERATION_CAPABILITY = "document_generation";
const CREATE_LEAVE_CAPABILITY = "create_leave_draft";
const SUBMIT_LEAVE_CAPABILITY = "submit_leave_draft";
const CANCEL_LEAVE_CAPABILITY = "cancel_leave_draft";
const LEGACY_LEAVE_REQUEST_CAPABILITY = "leave_request_tool";
const LEGACY_LEAVE_REQUEST = "leave_request";
const MAX_HISTORY_CONTEXT_CHARS = 18000;
const MAX_INTENT_HISTORY_CHARS = 4000;

const COMPANY_CONTEXT_TERMS = [
  "name",
  "called",
  "industry",
  "sector",
  "operate",
  "business",
  "address",
  "location",
  "phone",
  "email",
  "contact",
  "working hour",
  "work hour",
  "office hour",
  "hours",
  "registration",
  "registered",
  "tax",
  "logo",
  "information",
  "info",
  "details",
];

export const messageRequestsCompanyContext = (message = "") => {
  const normalized = message.toLowerCase().replace(/\s+/g, " ").trim();

  if (!normalized) {
    return false;
  }

  const mentionsCompany =
    /\b(company|employer|organization|organisation)\b/.test(normalized);
  if (!mentionsCompany) {
    return false;
  }

  if (
    /\b(company(?:'s|’s)?\s+name|name\s+of\s+(my|our|the)\s+company)\b/.test(
      normalized,
    )
  ) {
    return true;
  }

  if (
    /\b(all|available)\s+company\s+(information|info|details)\b/.test(
      normalized,
    )
  ) {
    return true;
  }

  if (
    /\b(company\s+policy|leave\s+policy|hr\s+policy)\b/.test(normalized) &&
    !/\b(available|exists|handbook)\b/.test(normalized)
  ) {
    return false;
  }

  return COMPANY_CONTEXT_TERMS.some((term) => normalized.includes(term));
};

const normalizeConversationMessages = (
  messages = [],
  maxChars = MAX_HISTORY_CONTEXT_CHARS,
) => {
  const normalizedMessages = messages
    .filter(
      (message) =>
        (message?.role === "user" || message?.role === "assistant") &&
        typeof message?.content === "string" &&
        message.content.trim(),
    )
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

const formatConversationHistoryForDebug = (messages = []) =>
  messages.length
    ? messages
        .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
        .join("\n\n")
    : "No previous conversation messages.";

const INTENT_SYSTEM_PROMPT = `Analyze the current user message and determine their intent, required capabilities, and required context data sources.
Use the prior conversation messages to resolve context-dependent requests such as summaries, translations, shorter rewrites, continuations, and follow-up questions.
Return only the structured JSON required by the schema.

Intent values:
- "calculation": mathematical or numerical computation (salary, totals, leave days math)
- "document_generation": creating a document or certificate (employment cert, salary slip, etc.)
- "employee_question": questions about the user's own profile, job title, department, leave balance, employment status
- "company_question": questions about the company itself — name, industry, address, phone, email, working hours, registration date — anything about the company as an entity
- "company_policy_question": questions about company HR policies, rules, procedures found in the policy handbook
- "labor_law_question": questions about Egyptian labor law or legal regulations
- "create_leave_draft": user wants to create or initiate a leave request
- "submit_leave_draft": user wants to confirm/submit a pending leave draft
- "cancel_leave_draft": user wants to cancel a leave request
- "general_conversation": greetings, follow-ups, clarifications, or any other request

requiresContext values (include ALL that apply):
- "employee": include when the answer requires knowing the user's profile — name, job title, department, leave balance, employment status
- "company": include when the answer requires knowing company details — company name, industry, address, working hours, contact info, registration date, or whether a policy handbook exists. ALWAYS include "company" for "company_question" intent.
- "rag": include when the answer requires searching the company policy documents or handbook

Examples:
- "What is the name of my company?" → intent: "company_question", requiresContext: ["company"]
- "What industry does my company operate in?" → intent: "company_question", requiresContext: ["company"]
- "What are my company's working hours?" → intent: "company_question", requiresContext: ["company"]
- "What is my job title?" → intent: "employee_question", requiresContext: ["employee"]
- "How many annual leave days do I have left?" → intent: "employee_question", requiresContext: ["employee"]
- "What is the leave policy?" → intent: "company_policy_question", requiresContext: ["rag"]`;

const buildIntentMessages = (message, conversationMessages = []) => [
  {
    role: "system",
    content: INTENT_SYSTEM_PROMPT,
  },
  ...normalizeConversationMessages(
    conversationMessages,
    MAX_INTENT_HISTORY_CHARS,
  ),
  {
    role: "user",
    content: message,
  },
];

const buildFinalMessages = ({
  message,
  conversationMessages = [],
  intent,
  gatheredData,
  capabilityResults,
}) => [
  {
    role: "system",
    content: `You are Wakeel AI, a helpful AI assistant.
Answer the current user message using the prior conversation messages plus the gathered data and capability results below.
If the current user asks to summarize, translate, shorten, explain, or continue prior content, apply the request to the relevant previous assistant response.
Do not claim there is no text to summarize when the prior messages contain relevant assistant content.
If capabilities return specific data, use it when it is relevant, but do not let an irrelevant capability result override a clear request about the previous assistant answer.

Company context rules:
- Gathered Data Context is trusted runtime data from the authenticated company context service.
- If gatheredData.company.companyName exists and the user asks for the company name, answer with that exact value.
- If gatheredData.company.industry exists and the user asks for the industry, answer with that exact value.
- If gatheredData.company.workingHours exists and the user asks for working hours, answer with that exact value.
- Do not ask the user to provide company details that already exist in gatheredData.company.
- Do not invent a company name or substitute company-policy/RAG content for company context.
- If gatheredData.company.error exists, say the company context could not be retrieved right now and do not fabricate the value.

Detected Intent: ${intent?.intent || "unknown"}

Gathered Data Context:
${JSON.stringify(gatheredData || {}, null, 2)}

Capability Execution Results:
${JSON.stringify(capabilityResults || [], null, 2)}`,
  },
  ...normalizeConversationMessages(
    conversationMessages,
    MAX_HISTORY_CONTEXT_CHARS,
  ),
  {
    role: "user",
    content: message,
  },
];

const normalizeIntent = (intent) => {
  const requiresCapabilities = Array.isArray(intent?.requiresCapabilities)
    ? intent.requiresCapabilities.map((capability) => {
        if (
          capability === LEGACY_LEAVE_REQUEST_CAPABILITY ||
          capability === LEGACY_LEAVE_REQUEST
        ) {
          return CREATE_LEAVE_CAPABILITY; // Default fallback for old prompts
        }
        return capability;
      })
    : [];

  if (
    intent?.intent === DOCUMENT_GENERATION_CAPABILITY &&
    !requiresCapabilities.includes(DOCUMENT_GENERATION_CAPABILITY)
  ) {
    requiresCapabilities.push(DOCUMENT_GENERATION_CAPABILITY);
  }

  if (
    intent?.intent === CREATE_LEAVE_CAPABILITY &&
    !requiresCapabilities.includes(CREATE_LEAVE_CAPABILITY)
  ) {
    requiresCapabilities.push(CREATE_LEAVE_CAPABILITY);
  }

  if (
    intent?.intent === SUBMIT_LEAVE_CAPABILITY &&
    !requiresCapabilities.includes(SUBMIT_LEAVE_CAPABILITY)
  ) {
    requiresCapabilities.push(SUBMIT_LEAVE_CAPABILITY);
  }

  if (
    intent?.intent === CANCEL_LEAVE_CAPABILITY &&
    !requiresCapabilities.includes(CANCEL_LEAVE_CAPABILITY)
  ) {
    requiresCapabilities.push(CANCEL_LEAVE_CAPABILITY);
  }

  const requiresContext = Array.isArray(intent?.requiresContext)
    ? intent.requiresContext
    : [];

  if (
    intent?.intent === "company_question" &&
    !requiresContext.includes("company")
  ) {
    requiresContext.push("company");
  }

  return {
    ...intent,
    requiresCapabilities: [...new Set(requiresCapabilities)],
    requiresContext: [...new Set(requiresContext)],
  };
};

export const reinforceIntentWithDeterministicContext = (message, intent) => {
  const normalizedIntent = normalizeIntent(intent);

  if (!messageRequestsCompanyContext(message)) {
    return normalizedIntent;
  }

  if (
    normalizedIntent.intent === "company_question" &&
    normalizedIntent.requiresContext.includes("company")
  ) {
    return normalizedIntent;
  }

  logger.warn(
    `[Orchestrator] Reinforcing company_question intent for explicit company-context request. ` +
      `Original intent=${normalizedIntent.intent || "unknown"}`,
  );

  return {
    ...normalizedIntent,
    intent: "company_question",
    requiresContext: [
      ...new Set([...(normalizedIntent.requiresContext || []), "company"]),
    ],
  };
};

const getRequestedCompanyFields = (message = "") => {
  const normalized = message.toLowerCase().replace(/\s+/g, " ").trim();
  const fields = [];

  if (
    /\b(company(?:'s|’s)?\s+name|name\s+of\s+(my|our|the)\s+company)\b/.test(
      normalized,
    )
  ) {
    fields.push("companyName");
  }

  if (/\b(industry|sector|operate|business)\b/.test(normalized)) {
    fields.push("industry");
  }

  if (/\b(working hour|work hour|office hour|hours)\b/.test(normalized)) {
    fields.push("workingHours");
  }

  if (/\b(address|location)\b/.test(normalized)) {
    fields.push("address");
  }

  if (/\b(phone|contact number)\b/.test(normalized)) {
    fields.push("phoneNumber");
  }

  if (/\b(email)\b/.test(normalized)) {
    fields.push("email");
  }

  if (
    /\b(all|available)\s+company\s+(information|info|details)\b/.test(
      normalized,
    )
  ) {
    return [
      "companyName",
      "industry",
      "workingHours",
      "address",
      "phoneNumber",
      "email",
      "registeredAt",
    ];
  }

  return [...new Set(fields)];
};

const COMPANY_FIELD_LABELS = {
  companyName: "company name",
  industry: "industry",
  workingHours: "working hours",
  address: "address",
  phoneNumber: "phone number",
  email: "email",
  registeredAt: "registration date",
};

const buildTrustedCompanyAnswer = (message, company) => {
  if (!company || company.error) {
    return null;
  }

  const requestedFields = getRequestedCompanyFields(message).filter(
    (field) =>
      company[field] !== null &&
      company[field] !== undefined &&
      company[field] !== "",
  );

  if (!requestedFields.length) {
    return null;
  }

  if (requestedFields.length === 1 && requestedFields[0] === "companyName") {
    return `Your company name is ${company.companyName}.`;
  }

  if (requestedFields.length === 1 && requestedFields[0] === "industry") {
    return `Your company operates in the ${company.industry} industry.`;
  }

  if (requestedFields.length === 1 && requestedFields[0] === "workingHours") {
    return `Your company's working hours are ${company.workingHours}.`;
  }

  const details = requestedFields
    .map((field) => `${COMPANY_FIELD_LABELS[field]}: ${company[field]}`)
    .join("\n");

  return `Here is the company information available to me:\n${details}`;
};

const responseContradictsTrustedCompanyContext = (
  responseContent = "",
  company,
) => {
  const normalized = responseContent.toLowerCase();

  if (!company?.companyName) {
    return false;
  }

  if (normalized.includes(company.companyName.toLowerCase())) {
    return false;
  }

  return (
    normalized.includes("don't know") ||
    normalized.includes("do not know") ||
    normalized.includes("not seeing") ||
    normalized.includes("not available") ||
    normalized.includes("unavailable") ||
    normalized.includes("could you let me know") ||
    normalized.includes("provide your company")
  );
};

const getDocumentGenerationSkillResult = (capabilityResults) => {
  const result = capabilityResults.find(
    (candidate) =>
      candidate.capability === DOCUMENT_GENERATION_CAPABILITY &&
      candidate.status === "success" &&
      candidate.data?.data?.type === DOCUMENT_GENERATION_CAPABILITY,
  );

  return result?.data || null;
};

const buildDocumentGenerationResponse = (conversationId, skillResult) => {
  const payload = skillResult.data || {};
  const response = {
    conversationId,
    message:
      skillResult.message ||
      "I could not complete the document generation request.",
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
  const result = capabilityResults.find(
    (candidate) =>
      (candidate.capability === CREATE_LEAVE_CAPABILITY ||
        candidate.capability === SUBMIT_LEAVE_CAPABILITY ||
        candidate.capability === CANCEL_LEAVE_CAPABILITY) &&
      candidate.status === "success" &&
      candidate.data?.data?.type === "leave_request",
  );

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
    logger.info(
      `[Orchestrator] Intent detection started for message="${message}"`,
    );
    const analysis = await intentLlm.invoke(
      buildIntentMessages(message, conversationMessages),
    );
    logger.info(
      `[Orchestrator] Raw intent result = ${JSON.stringify(analysis)}`,
    );
    return normalizeIntent(analysis);
  } catch (error) {
    logger.error(`[Orchestrator] Failed to determine intent: ${error.message}`);
    // Fallback to general conversation if structured output fails
    return normalizeIntent({
      intent: "general_conversation",
      requiresCapabilities: [],
      requiresContext: [],
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
export const handleChat = async ({
  message,
  conversationId,
  context,
  conversationMessages = [],
}) => {
  logger.info(
    `[Orchestrator] Starting orchestration for conversation: ${conversationId}`,
  );
  logger.info(`[Orchestrator] Received message: "${message}"`);
  logger.info(
    "[Orchestrator] User context received. " +
      `userId present=${Boolean(context?.userId)} ` +
      `companyId present=${Boolean(context?.companyId)} ` +
      `role present=${Boolean(context?.role)}`,
  );

  try {
    // 1. Initialize Orchestration Context
    const orchContext = createOrchestratorContext(
      message,
      conversationId,
      context,
      conversationMessages,
    );

    // 2. Determine Intent & Required Capabilities
    orchContext.intent = reinforceIntentWithDeterministicContext(
      message,
      await determineIntent(message, orchContext.conversationMessages),
    );
    logger.info(
      `[Orchestrator] Intent determined: ${orchContext.intent.intent}`,
    );
    logger.info(
      `[Orchestrator] Intent result = ${JSON.stringify(orchContext.intent)}`,
    );
    logger.info(
      `[Orchestrator] requiresContext = ${JSON.stringify(orchContext.intent.requiresContext || [])}`,
    );

    // 3. Gather Required Context (Knowledge, Employee, Company)
    logger.info(
      `[Orchestrator] Calling gatherContextBoundary with requiresContext=${JSON.stringify(orchContext.intent.requiresContext || [])} ` +
        `companyId present=${Boolean(orchContext.userContext?.companyId)}`,
    );
    orchContext.gatheredData = await gatherContextBoundary(
      orchContext.intent.requiresContext,
      orchContext.userContext,
    );
    logger.info(
      `[Orchestrator] gatherContextBoundary returned keys=${JSON.stringify(Object.keys(orchContext.gatheredData || {}))} ` +
        `company context present=${Boolean(orchContext.gatheredData?.company && !orchContext.gatheredData.company.error)} ` +
        `company name present=${Boolean(orchContext.gatheredData?.company?.companyName)}`,
    );

    // 4. Execute Capabilities (Skills / Tools)
    orchContext.capabilityResults = await executeCapabilitiesBoundary(
      orchContext.intent.requiresCapabilities,
      orchContext,
    );

    const documentGenerationResult = getDocumentGenerationSkillResult(
      orchContext.capabilityResults,
    );
    if (documentGenerationResult) {
      logger.info(
        `[Orchestrator] Returning structured document generation response for conversation: ${conversationId}`,
      );
      return buildDocumentGenerationResponse(
        orchContext.conversationId,
        documentGenerationResult,
      );
    }

    const leaveRequestResult = getLeaveRequestToolResult(
      orchContext.capabilityResults,
    );
    if (leaveRequestResult) {
      logger.info(
        `[Orchestrator] Returning structured leave request response for conversation: ${conversationId}`,
      );
      return buildLeaveRequestResponse(
        orchContext.conversationId,
        leaveRequestResult,
      );
    }

    // 5. Generate Final Response
    const finalMessages = buildFinalMessages({
      message: orchContext.message,
      conversationMessages: orchContext.conversationMessages,
      intent: orchContext.intent,
      gatheredData: orchContext.gatheredData,
      capabilityResults: orchContext.capabilityResults,
    });
    const finalSystemPrompt =
      finalMessages.find((item) => item.role === "system")?.content || "";
    logger.info(
      `[Orchestrator] Final LLM prompt company context check. ` +
        `contains companyName=${finalSystemPrompt.includes("companyName")} ` +
        `contains actual companyName=${Boolean(
          orchContext.gatheredData?.company?.companyName &&
          finalSystemPrompt.includes(
            orchContext.gatheredData.company.companyName,
          ),
        )}`,
    );

    if (
      process.env.NODE_ENV === "test" ||
      process.env.WAKEEL_DEBUG_LLM_CONTEXT === "true"
    ) {
      logger.debug("[Orchestrator] Final LLM context summary", {
        conversationId,
        historyLength: orchContext.conversationMessages.length,
        historyRoles: orchContext.conversationMessages.map((item) => item.role),
        currentUserMessage: orchContext.message,
        historyPreview: formatConversationHistoryForDebug(
          normalizeConversationMessages(orchContext.conversationMessages, 2000),
        ),
        gatheredDataKeys: Object.keys(orchContext.gatheredData || {}),
        hasCompanyContext: Boolean(
          orchContext.gatheredData?.company &&
          !orchContext.gatheredData.company.error,
        ),
        hasCompanyName: Boolean(orchContext.gatheredData?.company?.companyName),
        companyContextError:
          orchContext.gatheredData?.company?.error?.code || null,
      });
    }

    logger.info("[Orchestrator] Sending final prompt to LLM");
    const finalResponse = await llm.invoke(finalMessages);
    const finalResponseContent = String(finalResponse.content ?? "");
    const trustedCompanyAnswer = buildTrustedCompanyAnswer(
      orchContext.message,
      orchContext.gatheredData?.company,
    );
    const shouldUseTrustedCompanyAnswer =
      trustedCompanyAnswer &&
      (responseContradictsTrustedCompanyContext(
        finalResponseContent,
        orchContext.gatheredData.company,
      ) ||
        (getRequestedCompanyFields(orchContext.message).includes(
          "companyName",
        ) &&
          orchContext.gatheredData.company?.companyName &&
          !finalResponseContent
            .toLowerCase()
            .includes(
              orchContext.gatheredData.company.companyName.toLowerCase(),
            )));

    logger.info(
      `[Orchestrator] Finished orchestration for conversation: ${conversationId}`,
    );

    const allSources = [];
    if (Array.isArray(orchContext.capabilityResults)) {
      orchContext.capabilityResults.forEach((res) => {
        if (
          res.status === "success" &&
          res.data?.sources &&
          Array.isArray(res.data.sources)
        ) {
          allSources.push(...res.data.sources);
        }
      });
    }

    // Return using the shared ChatResponse shape
    return {
      conversationId: orchContext.conversationId,
      message: shouldUseTrustedCompanyAnswer
        ? trustedCompanyAnswer
        : finalResponseContent,
      type: "text",
      sources: allSources,
      actions: [], // Will be populated in Task 3.9
    };
  } catch (error) {
    logger.error(
      `[Orchestrator] Fatal error during orchestration: ${error.message}`,
    );

    // Controlled error response without leaking internals
    return {
      conversationId,
      message: "An internal error occurred while processing your request.",
      type: "text",
      sources: [],
      actions: [],
    };
  }
};
