import { logger } from "../shared/logger.js";
import { config, llmConfig } from "../config/env.js";
import { createLLM } from "../llm/llm-provider.js";
import { z } from "zod";
import { ChatResponseSchema } from "../contracts/index.js";
import { createOrchestratorContext } from "./orchestrator-context.js";
import { enrichLeaveIntentWithDeterministicContext } from "./leave-intent.js";
import { reinforceLeaveConfirmationIntent } from "./leave-draft-context.js";
import {
  gatherContextBoundary,
  executeCapabilitiesBoundary,
} from "./dependency-boundaries.js";
import {
  normalizeArabic,
  containsArabic,
} from "../shared/arabic-utils.js";
import {
  resolveTargetEmployee,
  hasEmployeePronounOrReference,
} from "./employee-resolver.js";

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
      "out_of_scope",
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
const COMPANY_POLICY_CAPABILITY = "company_policy";
const LABOR_LAW_CAPABILITY = "labor_law";
const LEGACY_LEAVE_REQUEST_CAPABILITY = "leave_request_tool";
const LEGACY_LEAVE_REQUEST = "leave_request";
const MAX_HISTORY_CONTEXT_CHARS = 10000;
const MAX_INTENT_HISTORY_CHARS = 3000;

const STRUCTURED_CAPABILITY_HINTS = Object.freeze({
  employee_context: {
    intent: "employee_question",
    requiresCapabilities: [],
    requiresContext: ["employee"],
  },
  company_context: {
    intent: "company_question",
    requiresCapabilities: [],
    requiresContext: ["company"],
  },
  company_policy: {
    intent: "company_policy_question",
    requiresCapabilities: [COMPANY_POLICY_CAPABILITY],
    requiresContext: ["rag"],
  },
  labor_law: {
    intent: "labor_law_question",
    requiresCapabilities: [LABOR_LAW_CAPABILITY],
    requiresContext: ["rag"],
  },
  calculation: {
    intent: "calculation",
    requiresCapabilities: ["calculation"],
    requiresContext: [],
  },
  document_generate: {
    intent: DOCUMENT_GENERATION_CAPABILITY,
    requiresCapabilities: [DOCUMENT_GENERATION_CAPABILITY],
    requiresContext: ["employee"],
  },
  document_generation: {
    intent: DOCUMENT_GENERATION_CAPABILITY,
    requiresCapabilities: [DOCUMENT_GENERATION_CAPABILITY],
    requiresContext: ["employee"],
  },
});

const normalizeCapabilityHint = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");

const getStructuredCapabilityHint = (userContext = {}) => {
  const rawCapability =
    userContext?.field_values?.capability ||
    userContext?.field_values?.intent ||
    userContext?.capability ||
    userContext?.intent;
  const normalizedCapability = normalizeCapabilityHint(rawCapability);
  const hint = STRUCTURED_CAPABILITY_HINTS[normalizedCapability];

  if (!hint) return null;

  return {
    capability: normalizedCapability,
    ...hint,
  };
};

const reinforceIntentWithStructuredCapabilityHint = (
  intent,
  userContext = {},
) => {
  const hint = getStructuredCapabilityHint(userContext);
  if (!hint) return intent;

  logger.warn(
    `[Orchestrator] Applying structured capability hint=${hint.capability}. ` +
      `Original intent=${intent?.intent || "unknown"}`,
  );

  return normalizeIntent({
    ...intent,
    intent: hint.intent,
    requiresCapabilities: hint.requiresCapabilities,
    requiresContext: [
      ...new Set([...(intent?.requiresContext || []), ...hint.requiresContext]),
    ],
  });
};

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

const COMPANY_CONTEXT_ARABIC_TERMS = [
  "اسم",
  "مجال",
  "قطاع",
  "نشاط",
  "عنوان",
  "مقر",
  "موقع",
  "تليفون",
  "هاتف",
  "موبايل",
  "ايميل",
  "بريد",
  "ساعات العمل",
  "مواعيد العمل",
  "اوقات العمل",
  "سجل",
  "ضريبي",
  "لوجو",
  "شعار",
  "معلومات",
  "بيانات",
  "تفاصيل",
];

export const messageRequestsCompanyContext = (message = "") => {
  if (!message) return false;
  const normalized = message.toLowerCase().replace(/\s+/g, " ").trim();
  const normAr = normalizeArabic(message);

  if (!normalized) {
    return false;
  }

  const mentionsCompanyEn =
    /\b(company|employer|organization|organisation)\b/.test(normalized);
  const mentionsCompanyAr =
    /(?:^|\s)(?:الشركة|شركتنا|المؤسسة|المؤسسه|جهة العمل|جهه العمل)(?:$|\s|[.,?!])/i.test(
      normAr,
    );

  if (!mentionsCompanyEn && !mentionsCompanyAr) {
    return false;
  }

  if (
    /\b(company(?:'s|’s)?\s+name|name\s+of\s+(my|our|the)\s+company)\b/.test(
      normalized,
    ) ||
    /(?:اسم\s+الشركة|اسم\s+شركتنا|الشركة\s+اسمها\s+ايه|ايه\s+اسم\s+الشركة)/i.test(
      normAr,
    )
  ) {
    return true;
  }

  if (
    /\b(all|available)\s+company\s+(information|info|details)\b/.test(
      normalized,
    ) ||
    /(?:معلومات\s+الشركة|بيانات\s+الشركة|كل\s+بيانات\s+الشركة|تفاصيل\s+الشركة)/i.test(
      normAr,
    )
  ) {
    return true;
  }

  if (
    (/\b(company\s+policy|leave\s+policy|hr\s+policy)\b/.test(normalized) ||
      /(?:سياسة\s+الشركة|لائحة\s+الشركة|لائحه\s+الشركة)/i.test(normAr)) &&
    !/\b(available|exists|handbook)\b/.test(normalized)
  ) {
    return false;
  }

  return (
    COMPANY_CONTEXT_TERMS.some((term) => normalized.includes(term)) ||
    COMPANY_CONTEXT_ARABIC_TERMS.some((term) => normAr.includes(term))
  );
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
Use the prior conversation messages to resolve context-dependent requests such as summaries, translations, shorter rewrites, continuations, follow-up questions, and pronoun references.
Return only the structured JSON required by the schema.

Intent values:
- "calculation": mathematical or numerical computation (salary, totals, end of service gratuity math, leave days math)
- "document_generation": creating or drafting an HR document/certificate (employment contract, warning letter, termination letter, etc.)
- "employee_question": questions about an employee's profile, job title, department, salary, leave balance, employment status (for self or targeted employee)
- "company_question": questions about the company itself — name, industry, address, phone, email, working hours, registration date — anything about the company as an entity
- "company_policy_question": questions about company HR policies, rules, procedures found in the policy handbook
- "labor_law_question": questions about Egyptian labor law or legal regulations (Law No. 12 of 2003)
- "create_leave_draft": user wants to create or initiate a leave request
- "submit_leave_draft": user wants to confirm/submit a pending leave draft
- "cancel_leave_draft": user wants to cancel a leave request
- "general_conversation": greetings, follow-ups, clarifications, or any other request
- "out_of_scope": clearly unrelated requests like cooking, general programming, weather, general jokes.

requiresContext values (include ALL that apply):
- "employee": include when the answer requires knowing the employee's profile – name, job title, department, salary, leave balance, employment status
- "company": include when the answer requires knowing company details — company name, industry, address, working hours, contact info, registration date, or whether a policy handbook exists. ALWAYS include "company" for "company_question" intent.
- "rag": include when the answer requires searching the company policy documents or handbook

Bilingual Examples (English & Arabic):
- "What is the name of my company?" / "ايه اسم الشركة؟" → intent: "company_question", requiresContext: ["company"]
- "What industry does my company operate in?" / "الشركة شغالة في ايه؟" → intent: "company_question", requiresContext: ["company"]
- "What are my company's working hours?" / "مواعيد العمل بالشركة ايه؟" → intent: "company_question", requiresContext: ["company"]
- "What is my job title?" / "ايه وظيفتي؟" → intent: "employee_question", requiresContext: ["employee"]
- "What is my salary?" / "مرتبي كام؟" → intent: "employee_question", requiresContext: ["employee"]
- "How many annual leave days do I have left?" / "عندي كام يوم إجازة؟" → intent: "employee_question", requiresContext: ["employee"]
- "What do you know about Farida?" / "تعرف ايه عن فريدة" / "ماذا تعرف عن نورهان" → intent: "employee_question", requiresContext: ["employee"]
- "What is the leave policy?" / "ايه سياسة الشركة بخصوص الإجازات؟" → intent: "company_policy_question", requiresCapabilities: ["company_policy"], requiresContext: ["rag"]
- "What are the annual leave rules under Egyptian Labor Law?" / "ما هي قواعد الإجازة السنوية في قانون العمل المصري؟" → intent: "labor_law_question", requiresCapabilities: ["labor_law"], requiresContext: ["rag"]
- "create a contract for Farida" / "اعملي عقد عمل لفريدة" / "اعملي عقد ليها" → intent: "document_generation", requiresCapabilities: ["document_generation"], requiresContext: ["employee"]`;

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
}) => {
  const sections = [
    `You are Wakeel AI, a helpful AI assistant.
Answer the current user message using the prior conversation messages plus the gathered data and capability results below.
If the current user asks to summarize, translate, shorten, explain, or continue prior content, apply the request to the relevant previous assistant response.
Do not claim there is no text to summarize when the prior messages contain relevant assistant content.
If capabilities return specific data, use it when it is relevant, but do not let an irrelevant capability result override a clear request about the previous assistant answer.`
  ];

  // Company context rules - dynamically added only when company context was gathered or attempted
  if (gatheredData?.company && !gatheredData.company.error) {
    sections.push(`Company context rules:
- Gathered Data Context contains trusted runtime data from the authenticated company context service for ${gatheredData.company.companyName || "the user's company"}.
- If gatheredData.company.companyName exists and the user asks for the company name, answer with that exact value.
- If gatheredData.company.industry exists and the user asks for the industry, answer with that exact value.
- If gatheredData.company.workingHours exists and the user asks for working hours, answer with that exact value.
- Do not ask the user to provide company details that already exist in gatheredData.company.
- Do not invent a company name or substitute company-policy/RAG content for company context.`);
  } else if (gatheredData?.company?.error) {
    sections.push(`Company context rules:
- Company context could not be retrieved (${gatheredData.company.error.message || "service error"}). Say the company context could not be retrieved right now and do not fabricate the value.`);
  }

  // Employee context rules - dynamically added only when employee context was gathered or attempted
  if (gatheredData?.employee && !gatheredData.employee.error) {
    sections.push(`Employee context & name preservation rules:
- CRITICAL: Employee names in gatheredData.employee.full_name are identity data and must NEVER be transliterated, translated, or altered.
- When responding in Arabic about an employee, use the EXACT name from gatheredData.employee.full_name without modification.
- Do NOT attempt to convert Latin names like "assem" into Arabic equivalents.
- If the name in gatheredData is "assem", write "assem" in your response, not any Arabic version.
- Employee identity must remain unchanged regardless of response language.

PRIVACY & DATA PROTECTION RULES:
- NEVER expose the raw employee record_id (UUID) or any internal database IDs to the user. You can mention their name, job details, and employment status, but keep the underlying ID completely hidden.
- Only translate surrounding context (job titles, actions), never the employee's name itself.
- Leave balances: If sick or unpaid leave is marked as is_uncapped = true, clarify that this leave type has no day cap rather than reporting 0 days remaining.

END-OF-SERVICE / GRATUITY CALCULATION (Egyptian rule):
- Requires gatheredData.employee.hire_date and gatheredData.employee.salary. If either is missing, ask the user for it — do NOT guess.
- Compute completed years of service = from hire_date to today.
- Gratuity = (0.5 month salary) x (each of the first 5 years) + (1 month salary) x (each year beyond 5).
  Example: 8 years at 10,000 EGP/month => (0.5 x 10000 x 5) + (1 x 10000 x 3) = 25,000 + 30,000 = 55,000 EGP.
- Always show the year breakdown and use the EXACT salary and hire_date from gatheredData.employee. Never fabricate figures.`);
  } else if (gatheredData?.employee?.error) {
    sections.push(`Employee context rules:
- Employee profile retrieval failed (${gatheredData.employee.error.message || "service error"}). State clearly that employee details could not be retrieved right now. Do not fabricate salary, hire date, or profile information.`);
  }

  sections.push(`JURISDICTION & LEGAL STRICTNESS (MANDATORY):
- You operate EXCLUSIVELY under EGYPTIAN LABOR LAW (Law No. 12 of 2003 and its amendments).
- You are STRICTLY FORBIDDEN from citing, applying, or referencing Saudi Labor Law, GCC/Gulf law, UAE law, or ANY non-Egyptian jurisdiction. Never invent article numbers.
- If asked about another country's law, state that Wakeel AI only advises on Egyptian Labor Law.`);

  sections.push(`Detected Intent: ${intent?.intent || "unknown"}`);

  if (gatheredData && Object.keys(gatheredData).length > 0) {
    sections.push(`Gathered Data Context:\n${JSON.stringify(gatheredData, null, 2)}`);
  }

  if (capabilityResults && capabilityResults.length > 0) {
    sections.push(`Capability Execution Results:\n${JSON.stringify(capabilityResults, null, 2)}`);
  }

  sections.push(`RESPONSE FORMATTING RULES (MANDATORY):
- Use standard Markdown with ASCII asterisks only: **bold** for emphasis, *italic* for light emphasis.
- Do NOT use Unicode asterisk characters (∗ ＊ ﹡ ⁎ ٭) anywhere in your response.
- For mathematical calculations and results, format them as plain Markdown text with bold emphasis where needed.
  Example: مكافأة نهاية الخدمة = 0 × (0.5 × 600) = **0 جنيه**
- Do NOT wrap entire calculation lines, Arabic sentences, or bold text inside LaTeX math delimiters \\(...\\) or \\[...\\].
- Only use LaTeX math delimiters for pure mathematical expressions that contain no Arabic text, no markdown bold, and no plain-text labels.
- Tables, lists, headings, and code blocks follow standard GitHub Markdown syntax.`);

  return [
    {
      role: "system",
      content: sections.join("\n\n"),
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
};

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

  if (
    intent?.intent === "company_policy_question" &&
    !requiresCapabilities.includes(COMPANY_POLICY_CAPABILITY)
  ) {
    requiresCapabilities.push(COMPANY_POLICY_CAPABILITY);
  }

  if (
    intent?.intent === "labor_law_question" &&
    !requiresCapabilities.includes(LABOR_LAW_CAPABILITY)
  ) {
    requiresCapabilities.push(LABOR_LAW_CAPABILITY);
  }

  if (
    intent?.intent === "calculation" &&
    !requiresCapabilities.includes("calculation")
  ) {
    requiresCapabilities.push("calculation");
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

  if (
    intent?.intent === "employee_question" &&
    !requiresContext.includes("employee")
  ) {
    requiresContext.push("employee");
  }

  return {
    ...intent,
    requiresCapabilities: [...new Set(requiresCapabilities)],
    requiresContext: [...new Set(requiresContext)],
  };
};

export const messageRequestsDocumentGeneration = (message = "") => {
  if (!message) return false;
  const normalized = message.toLowerCase().trim();
  const normAr = normalizeArabic(message);

  const englishDocPattern =
    /\b(?:create|generate|draft|make|prepare|write)\s+(?:an?\s+)?(?:employment\s+)?(?:contract|warning\s+letter|termination\s+letter)\b/i.test(
      normalized,
    ) ||
    /\b(?:contract|warning\s+letter|termination\s+letter)\s+(?:for|to)\b/i.test(
      normalized,
    );

  const arabicDocPattern =
    /(?:اعمل|اعملي|انشئ|أنشئ|اكتب|اكتبي|جهز|جهزي|صيغ|صيغي|عايز\s+اعمل|عايز\s+انشئ|نعمل)\s+(?:عقد|عقد\s+عمل|عقد\s+توظيف|خطاب\s+انذار|خطاب\s+إنذار|انذار|إنذار|خطاب\s+انهاء\s+خدمة|خطاب\s+إنهاء\s+خدمة|انهاء\s+خدمة|إنهاء\s+خدمة|فصل)/iu.test(
      normAr,
    ) ||
    /(?:عقد\s+عمل|عقد\s+توظيف|خطاب\s+انذار|خطاب\s+إنذار|خطاب\s+انهاء\s+خدمة|خطاب\s+إنهاء\s+خدمة)\s+(?:لـ?|للموظف|للموظفه|ليها|ليه|له|لها)/iu.test(
      normAr,
    );

  return englishDocPattern || arabicDocPattern;
};

export const messageRequestsLaborLaw = (message = "") => {
  if (!message) return false;
  const normalized = message.toLowerCase().trim();
  const normAr = normalizeArabic(message);

  const englishLawPattern =
    /\b(?:labor\s+law|labour\s+law|egyptian\s+labor\s+law|egyptian\s+law|law\s+12|statutory\s+leave|under\s+(?:the\s+)?law|labor\s+regulation)\b/i.test(
      normalized,
    );

  const arabicLawPattern =
    /(?:قانون\s+العمل|قانون\s+العمل\s+المصري|القانون\s+المصري|قانون\s+12|حسب\s+القانون|في\s+قانون\s+العمل|حقوق\s+الموظف\s+في\s+قانون|مكاف[اأ]?[ةه]\s+نهاي[ةه]\s+الخدم[ةه]|فتر[ةه]\s+الاخطار|قوانين\s+الاجازات|قواعد\s+الاجاز[ةه]\s+السنوي[ةه]|حقوق\s+الموظف\s+في\s+الاجاز[ةه])/iu.test(
      normAr,
    );

  return englishLawPattern || arabicLawPattern;
};

export const messageRequestsCompanyPolicy = (message = "") => {
  if (!message) return false;
  const normalized = message.toLowerCase().trim();
  const normAr = normalizeArabic(message);

  const englishPolicyPattern =
    /\b(?:company(?:'s)?(?:\s+\w+)?\s+policy|leave\s+policy|hr\s+policy|internal\s+policy|company\s+handbook|company\s+rules|handbook\s+say|policy\s+on)\b/i.test(
      normalized,
    );

  const arabicPolicyPattern =
    /(?:سياس[ةه]\s+(?:الشرك[ةه]|الاجازات|العمل)|لائح[ةه]\s+الشرك[ةه]|دليل\s+الموظف|قواعد\s+الشرك[ةه]|الشرك[ةه]\s+بتقول\s+ايه|حسب\s+سياس[ةه]|هل\s+سياس[ةه]|سياس[ةه].*الشرك[ةه]|الشرك[ةه].*سياس[ةه])/iu.test(
      normAr,
    );

  return englishPolicyPattern || arabicPolicyPattern;
};

export const messageRequestsEmployeeContext = (message = "", userContext = {}) => {
  if (!message) return false;
  const normalized = message.toLowerCase().replace(/\s+/g, " ").trim();
  const normAr = normalizeArabic(message);

  if (hasEmployeePronounOrReference(message)) {
    return true;
  }

  const mentionsTargetResolution =
    /\b(what\s+do\s+you\s+know\s+about|tell\s+me\s+about|who\s+is|info\s+about|details\s+about|profile\s+of|employee\s+details|salary\s+of|leave\s+balance\s+of)\b/i.test(
      normalized,
    ) ||
    /(?:تعرف\s+(?:ايه\s+)?عن|ماذا\s+تعرف\s+عن|قولي\s+(?:معلومات\s+)?عن|عايز\s+معلومات\s+عن|هات\s+بيانات|بيانات\s+الموظف|معلومات\s+الموظف|معلومات\s+عن|مين\s+هو|مين\s+هي|مرتب|راتب|رصيد\s+اجازات|شغال[ةه]?\s+ايه)/iu.test(
      normAr,
    );

  if (userContext?.targetEmployeeName) {
    const targetParts = userContext.targetEmployeeName
      .toLowerCase()
      .split(/\s+/)
      .filter((p) => p.length >= 2);
    if (
      targetParts.some(
        (part) =>
          normalized.includes(part) ||
          normAr.includes(normalizeArabic(part)),
      )
    ) {
      return true;
    }
  }

  if (
    userContext?.targetEmployeeId &&
    (hasEmployeePronounOrReference(message) || mentionsTargetResolution)
  ) {
    return true;
  }

  return mentionsTargetResolution;
};

export const reinforceIntentWithDeterministicContext = (
  message,
  intent,
  userContext = {},
) => {
  let normalizedIntent = normalizeIntent(intent);

  if (messageRequestsCompanyContext(message)) {
    if (
      normalizedIntent.intent !== "company_question" ||
      !normalizedIntent.requiresContext.includes("company")
    ) {
      logger.warn(
        `[Orchestrator] Reinforcing company_question intent for explicit company-context request. ` +
          `Original intent=${normalizedIntent.intent || "unknown"}`,
      );
      normalizedIntent = {
        ...normalizedIntent,
        intent: "company_question",
        requiresContext: [
          ...new Set([...(normalizedIntent.requiresContext || []), "company"]),
        ],
      };
    }
  }

  if (messageRequestsDocumentGeneration(message)) {
    if (
      normalizedIntent.intent !== DOCUMENT_GENERATION_CAPABILITY ||
      !normalizedIntent.requiresCapabilities.includes(
        DOCUMENT_GENERATION_CAPABILITY,
      )
    ) {
      logger.warn(
        `[Orchestrator] Reinforcing document_generation intent for explicit document generation request. ` +
          `Original intent=${normalizedIntent.intent || "unknown"}`,
      );
      normalizedIntent = {
        ...normalizedIntent,
        intent: DOCUMENT_GENERATION_CAPABILITY,
        requiresCapabilities: [
          ...new Set([
            ...(normalizedIntent.requiresCapabilities || []),
            DOCUMENT_GENERATION_CAPABILITY,
          ]),
        ],
        requiresContext: [
          ...new Set([...(normalizedIntent.requiresContext || []), "employee"]),
        ],
      };
    }
  }

  if (
    messageRequestsLaborLaw(message) &&
    normalizedIntent.intent !== DOCUMENT_GENERATION_CAPABILITY
  ) {
    if (
      normalizedIntent.intent !== "labor_law_question" ||
      !normalizedIntent.requiresCapabilities.includes(LABOR_LAW_CAPABILITY)
    ) {
      logger.warn(
        `[Orchestrator] Reinforcing labor_law_question intent for explicit labor law request. ` +
          `Original intent=${normalizedIntent.intent || "unknown"}`,
      );
      normalizedIntent = {
        ...normalizedIntent,
        intent: "labor_law_question",
        requiresCapabilities: [
          ...new Set([
            ...(normalizedIntent.requiresCapabilities || []),
            LABOR_LAW_CAPABILITY,
          ]),
        ],
      };
    }
  }

  if (
    messageRequestsCompanyPolicy(message) &&
    normalizedIntent.intent !== DOCUMENT_GENERATION_CAPABILITY
  ) {
    if (
      normalizedIntent.intent !== "company_policy_question" ||
      !normalizedIntent.requiresCapabilities.includes(COMPANY_POLICY_CAPABILITY)
    ) {
      logger.warn(
        `[Orchestrator] Reinforcing company_policy_question intent for explicit company policy request. ` +
          `Original intent=${normalizedIntent.intent || "unknown"}`,
      );
      normalizedIntent = {
        ...normalizedIntent,
        intent: "company_policy_question",
        requiresCapabilities: [
          ...new Set([
            ...(normalizedIntent.requiresCapabilities || []),
            COMPANY_POLICY_CAPABILITY,
          ]),
        ],
      };
    }
  }

  if (
    messageRequestsEmployeeContext(message, userContext) &&
    normalizedIntent.intent !== DOCUMENT_GENERATION_CAPABILITY &&
    normalizedIntent.intent !== "out_of_scope"
  ) {
    if (!normalizedIntent.requiresContext.includes("employee")) {
      logger.warn(
        `[Orchestrator] Reinforcing employee context for employee inquiry. ` +
          `Original intent=${normalizedIntent.intent || "unknown"}`,
      );
      const nextIntent =
        normalizedIntent.intent === "general_conversation"
          ? "employee_question"
          : normalizedIntent.intent;
      normalizedIntent = {
        ...normalizedIntent,
        intent: nextIntent,
        requiresContext: [
          ...new Set([...(normalizedIntent.requiresContext || []), "employee"]),
        ],
      };
    }
  }

  return reinforceIntentWithStructuredCapabilityHint(
    normalizedIntent,
    userContext,
  );
};

const getRequestedCompanyFields = (message = "") => {
  const normalized = message.toLowerCase().replace(/\s+/g, " ").trim();
  const normAr = normalizeArabic(message);
  const fields = [];

  if (
    /\b(company(?:'s|’s)?\s+name|name\s+of\s+(my|our|the)\s+company)\b/.test(
      normalized,
    ) ||
    /(?:اسم\s+الشركة|اسم\s+شركتنا|الشركة\s+اسمها\s+ايه|ايه\s+اسم\s+الشركة)/i.test(
      normAr,
    )
  ) {
    fields.push("companyName");
  }

  if (
    /\b(industry|sector|operate|business)\b/.test(normalized) ||
    /(?:مجال|قطاع|نشاط|شغالة\s+في\s+ايه|شغاله\s+في\s+ايه)/i.test(normAr)
  ) {
    fields.push("industry");
  }

  if (
    /\b(working hour|work hour|office hour|hours)\b/.test(normalized) ||
    /(?:ساعات\s+العمل|مواعيد\s+العمل|اوقات\s+العمل)/i.test(normAr)
  ) {
    fields.push("workingHours");
  }

  if (
    /\b(address|location)\b/.test(normalized) ||
    /(?:عنوان|مقر|موقع)/i.test(normAr)
  ) {
    fields.push("address");
  }

  if (
    /\b(phone|contact number)\b/.test(normalized) ||
    /(?:تليفون|هاتف|موبايل|رقم\s+التواصل)/i.test(normAr)
  ) {
    fields.push("phoneNumber");
  }

  if (
    /\b(email)\b/.test(normalized) ||
    /(?:ايميل|بريد|البريد\s+الالكتروني)/i.test(normAr)
  ) {
    fields.push("email");
  }

  if (
    /\b(all|available)\s+company\s+(information|info|details)\b/.test(
      normalized,
    ) ||
    /(?:معلومات\s+الشركة|بيانات\s+الشركة|كل\s+بيانات\s+الشركة|تفاصيل\s+الشركة)/i.test(
      normAr,
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

  const isAr = containsArabic(message);

  if (requestedFields.length === 1 && requestedFields[0] === "companyName") {
    return isAr
      ? `اسم الشركة هو ${company.companyName}.`
      : `Your company name is ${company.companyName}.`;
  }

  if (requestedFields.length === 1 && requestedFields[0] === "industry") {
    return isAr
      ? `تعمل الشركة في قطاع ${company.industry}.`
      : `Your company operates in the ${company.industry} industry.`;
  }

  if (requestedFields.length === 1 && requestedFields[0] === "workingHours") {
    return isAr
      ? `مواعيد العمل بالشركة هي ${company.workingHours}.`
      : `Your company's working hours are ${company.workingHours}.`;
  }

  const details = requestedFields
    .map((field) => `${COMPANY_FIELD_LABELS[field]}: ${company[field]}`)
    .join("\n");

  return isAr
    ? `إليك بيانات الشركة المتوفرة:\n${details}`
    : `Here is the company information available to me:\n${details}`;
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

    // 1b. Resolve Target Employee (Arabic/English name extraction, pronoun resolution, company-scoped search)
    const employeeResolution = await resolveTargetEmployee({
      message: orchContext.message,
      userContext: orchContext.userContext,
      conversationId: orchContext.conversationId,
    });
    orchContext.userContext = employeeResolution.userContext;

    // 2. Determine Intent & Required Capabilities
    orchContext.intent = reinforceIntentWithDeterministicContext(
      message,
      await determineIntent(message, orchContext.conversationMessages),
      orchContext.userContext,
    );
    orchContext.intent = enrichLeaveIntentWithDeterministicContext(
      message,
      orchContext.intent,
      orchContext.conversationMessages,
    );
    // A bare "yes" / "نعم" answering the submit-confirmation question must land
    // on submit_leave_draft, not on whatever the intent LLM guessed. Runs last
    // so it wins over the create-leave enrichment above.
    orchContext.intent = reinforceLeaveConfirmationIntent(
      message,
      orchContext.intent,
      orchContext.conversationMessages,
    );

    orchContext.intent = reinforceIntentWithDeterministicContext(
      orchContext.message,
      orchContext.intent,
      orchContext.userContext,
    );

    if (orchContext.intent?.intent === "out_of_scope") {
      logger.info(`[Orchestrator] Rejecting out_of_scope request: ${conversationId}`);
      return {
        conversationId,
        message: "I'm Wakeel AI, an HR and employment legal assistant. I can help with employee information, HR calculations, company policies, Egyptian labor law, leave requests, and supported HR/document workflows.",
        type: "text",
        sources: [],
        actions: [],
      };
    }

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

    // Direct return for company_policy and labor_law when skill produced a grounded answer
    const policyResult = orchContext.capabilityResults?.find(
      (r) =>
        (r.name === COMPANY_POLICY_CAPABILITY || r.name === LABOR_LAW_CAPABILITY) &&
        r.status === "success" &&
        r.data?.answer,
    );
    if (policyResult) {
      logger.info(
        `[Orchestrator] Returning direct grounded skill response for ${policyResult.name} on conversation: ${conversationId}`,
      );
      return {
        conversationId: orchContext.conversationId,
        message: policyResult.data.answer,
        type: "text",
        sources: Array.isArray(policyResult.data.sources) ? policyResult.data.sources : [],
        actions: [],
      };
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
    const hasActualCompany = Boolean(
      orchContext.gatheredData?.company &&
      !orchContext.gatheredData.company.error &&
      orchContext.gatheredData.company.companyName &&
      finalSystemPrompt.includes(
        orchContext.gatheredData.company.companyName,
      ),
    );
    logger.info(
      `[Orchestrator] Final LLM prompt company context check. ` +
        `contains companyName=${finalSystemPrompt.includes("companyName")} ` +
        `contains actual companyName=${hasActualCompany}`,
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
