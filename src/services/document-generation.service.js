import { z } from "zod";
import { getActiveTemplate } from "../integrations/wakeel/template-api.js";
import { saveDocument } from "../integrations/wakeel/document-api.js";
import { getCompanyContext } from "./company-context.service.js";
import { getHistory } from "./chat-history.service.js";
import { retrieveKnowledge } from "../rag/retrieval/knowledge-retrieval.service.js";
import { MissingFieldSchema, ResultCardSchema, SourceSchema } from "../contracts/index.js";
import { logger } from "../shared/logger.js";

const CONTRACT_DOCUMENT_TYPE = "Contract";
const MAX_HISTORY_MESSAGES = 50;

export const SUPPORTED_DOCUMENT_TYPES = Object.freeze([
  {
    document_type: CONTRACT_DOCUMENT_TYPE,
    label: "Employment Contract",
    title_prefix: "Employment Contract",
    aliases: ["contract", "employment contract", "employment_contract"],
  },
]);

const UNSUPPORTED_DOCUMENT_TYPE_KEYWORDS = Object.freeze([
  { keyword: /\bwarning\b/i, document_type: "Warning" },
  { keyword: /\btermination\b/i, document_type: "Termination" },
]);

const COMPANY_FIELD_MAP = Object.freeze({
  company_name: "name",
  company_id: "id",
  company_tax_id: "tax_id",
  tax_id: "tax_id",
  industry: "industry",
  company_industry: "industry",
  address: "address",
  company_address: "address",
  phone_number: "phone_number",
  phone: "phone_number",
  company_phone: "phone_number",
  email: "email",
  company_email: "email",
  logo_url: "logo_url",
  working_hours: "working_hours",
  company_working_hours: "working_hours",
  registered_at: "registered_at",
  registered_date: "registered_at",
});

const STRICT_COMPANY_FIELDS = Object.freeze(new Set([
  "company_name",
  "company_id",
  "company_tax_id",
  "tax_id",
  "industry",
  "company_industry",
  "address",
  "company_address",
  "phone_number",
  "phone",
  "company_phone",
  "email",
  "company_email",
  "logo_url",
  "registered_at",
  "registered_date",
]));

const COMMON_FIELD_PATTERNS = Object.freeze({
  employee_id: [
    /\bemployee\s*(?:id|number)\s*(?:is|=|:)\s*([A-Za-z0-9_-]+)/i,
    /\bemp(?:loyee)?\s*#\s*([A-Za-z0-9_-]+)/i,
  ],
  employee_name: [
    /\bemployee\s+name\s*(?:is|=|:)\s*([^,.;\n]+)/i,
    /\bname\s*(?:is|=|:)\s*([^,.;\n]+)/i,
    /\bfor\s+([^,.;\n]+?)(?=\s+(?:as|with|starting|start|salary)|[,.;]|$)/i,
  ],
  job_title: [
    /\b(?:job\s*title|position|role)\s*(?:is|=|:)\s*([^,.;\n]+)/i,
    /\bas\s+(?:a\s+|an\s+)?([^,.;\n]+?)(?=\s+(?:with\s+salary|salary|starting|start(?:\s+date)?|from)|[,.;]|$)/i,
  ],
  salary: [
    /\b(?:salary|wage|compensation)\s*(?:is|=|:)?\s*(?:egp|e\.g\.p\.|\$)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i,
  ],
  start_date: [
    /\b(?:start(?:ing)?(?:\s+date)?|starts(?:\s+on)?|from)\s*(?:is|=|:|on)?\s*([A-Za-z]+\s+\d{1,2}(?:,\s*\d{4})?|\d{1,2}\s+[A-Za-z]+(?:\s+\d{4})?|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/i,
  ],
  working_hours: [
    /\b(?:working\s+hours|work\s+hours|hours)\s*(?:are|is|=|:)\s*([^,.;\n]+)/i,
  ],
  document_type: [
    /\bdocument\s*type\s*(?:is|=|:)\s*([^,.;\n]+)/i,
  ],
});

const MONTHS = Object.freeze({
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
});

const LABEL_ACRONYMS = Object.freeze(new Set(["id", "url"]));

const DocumentGenerationInputSchema = z.object({
  message: z.string().trim().min(1),
  aiContext: z.object({
    userId: z.string().trim().min(1),
    companyId: z.string().trim().min(1),
    role: z.string().trim().min(1),
    conversationId: z.string().trim().min(1).optional(),
  }).passthrough(),
  conversationMessages: z.array(z.object({
    role: z.string().optional(),
    content: z.string(),
  }).passthrough()).optional(),
}).strict();

const createDomainError = (code, message, status = 400) => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
};

const hasValue = (value) => (
  value !== undefined
  && value !== null
  && String(value).trim().length > 0
);

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const escapeHtml = (value) => String(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const titleCase = (fieldName) => fieldName
  .split("_")
  .map((word) => (LABEL_ACRONYMS.has(word.toLowerCase())
    ? word.toUpperCase()
    : `${word.charAt(0).toUpperCase()}${word.slice(1)}`))
  .join(" ");

const inputTypeForField = (fieldName) => {
  if (fieldName === "document_type") return "dropdown";
  if (/date|registered_at/i.test(fieldName)) return "date";
  if (/salary|amount|number|days|hours_count|duration/i.test(fieldName)) return "number";
  return "text";
};

const missingFieldFor = (fieldName) => MissingFieldSchema.parse({
  field_name: fieldName,
  input_type: inputTypeForField(fieldName),
  label: titleCase(fieldName),
  options: fieldName === "document_type"
    ? SUPPORTED_DOCUMENT_TYPES.map((type) => type.document_type)
    : [],
});

const normalizeWhitespace = (value) => String(value).replace(/\s+/g, " ").trim();

const trimExtractedValue = (value) => normalizeWhitespace(value)
  .replace(/^["']|["']$/g, "")
  .replace(/\s+and\s+.*(?:\bis\b|\bare\b|=|:).*$/i, "")
  .replace(/[.]+$/g, "")
  .trim();

const normalizeDateValue = (value, baseDate = new Date()) => {
  const trimmed = trimExtractedValue(value);

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const [, month, day, rawYear] = slashMatch;
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const monthDayMatch = trimmed.match(/^([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?$/);
  if (monthDayMatch) {
    const [, monthName, rawDay, rawYear] = monthDayMatch;
    const month = MONTHS[monthName.toLowerCase()];
    if (month) {
      const year = rawYear || String(baseDate.getFullYear());
      return `${year}-${month}-${rawDay.padStart(2, "0")}`;
    }
  }

  const dayMonthMatch = trimmed.match(/^(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?$/);
  if (dayMonthMatch) {
    const [, rawDay, monthName, rawYear] = dayMonthMatch;
    const month = MONTHS[monthName.toLowerCase()];
    if (month) {
      const year = rawYear || String(baseDate.getFullYear());
      return `${year}-${month}-${rawDay.padStart(2, "0")}`;
    }
  }

  return trimmed;
};

const normalizeFieldValue = (fieldName, value, options = {}) => {
  const trimmed = trimExtractedValue(value);

  if (/date|registered_at/i.test(fieldName)) {
    return normalizeDateValue(trimmed, options.baseDate);
  }

  if (/salary|amount|number|days|hours_count|duration/i.test(fieldName)) {
    return trimmed.replace(/,/g, "");
  }

  return trimmed;
};

const labelPatternForField = (fieldName) => escapeRegex(fieldName).replace(/_/g, "\\s+");

const fieldMatchesRequestedSet = (fieldName, requestedFieldNames) => (
  requestedFieldNames.has(fieldName)
  || fieldName === "document_type"
  || fieldName === "employee_id"
);

export function extractFieldValuesFromMessage(message, fieldNames = [], options = {}) {
  const requestedFieldNames = new Set(fieldNames);
  const values = {};

  for (const [fieldName, patterns] of Object.entries(COMMON_FIELD_PATTERNS)) {
    if (!fieldMatchesRequestedSet(fieldName, requestedFieldNames)) continue;

    const pattern = patterns.find((candidate) => candidate.test(message));
    if (!pattern) continue;

    const match = message.match(pattern);
    if (match?.[1]) {
      values[fieldName] = normalizeFieldValue(fieldName, match[1], options);
    }
  }

  for (const fieldName of requestedFieldNames) {
    const pattern = new RegExp(`\\b${labelPatternForField(fieldName)}\\b\\s*(?:is|are|=|:)\\s*([^,.;\\n]+)`, "i");
    const match = message.match(pattern);
    if (match?.[1]) {
      values[fieldName] = normalizeFieldValue(fieldName, match[1], options);
    }
  }

  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => hasValue(value))
  );
}

const normalizeDocumentType = (value) => {
  const normalized = normalizeWhitespace(value).toLowerCase().replace(/-/g, "_");

  for (const type of SUPPORTED_DOCUMENT_TYPES) {
    if (
      normalized === type.document_type.toLowerCase()
      || type.aliases.some((alias) => normalized === alias.toLowerCase())
    ) {
      return { documentType: type.document_type };
    }
  }

  for (const unsupported of UNSUPPORTED_DOCUMENT_TYPE_KEYWORDS) {
    if (unsupported.keyword.test(value)) {
      return {
        unsupported: true,
        documentType: unsupported.document_type,
      };
    }
  }

  return null;
};

export function resolveDocumentTypeFromMessages(messages) {
  const combinedText = messages.map((message) => message.content || "").join("\n");
  const extracted = extractFieldValuesFromMessage(combinedText, ["document_type"]);

  if (extracted.document_type) {
    const explicit = normalizeDocumentType(extracted.document_type);
    if (explicit) return explicit;
  }

  for (const type of SUPPORTED_DOCUMENT_TYPES) {
    if (type.aliases.some((alias) => new RegExp(`\\b${escapeRegex(alias.replace(/_/g, " "))}\\b`, "i").test(combinedText))) {
      return { documentType: type.document_type };
    }
  }

  for (const unsupported of UNSUPPORTED_DOCUMENT_TYPE_KEYWORDS) {
    if (unsupported.keyword.test(combinedText)) {
      return {
        unsupported: true,
        documentType: unsupported.document_type,
      };
    }
  }

  return { missing: true };
}

export function extractPlaceholders(contentTemplate) {
  if (typeof contentTemplate !== "string" || contentTemplate.trim().length === 0) {
    throw createDomainError(
      "TEMPLATE_SCHEMA_INVALID",
      "The active template has no usable HTML content.",
      502
    );
  }

  const placeholders = [];
  const placeholderPattern = /\{\{\s*([^{}]+?)\s*\}\}/g;
  const consumedTemplate = contentTemplate.replace(placeholderPattern, (fullMatch, rawFieldName) => {
    const fieldName = rawFieldName.trim();

    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(fieldName)) {
      throw createDomainError(
        "TEMPLATE_SCHEMA_INVALID",
        `Invalid placeholder name: ${fieldName}`,
        502
      );
    }

    if (!placeholders.includes(fieldName)) {
      placeholders.push(fieldName);
    }

    return "";
  });

  if (/\{\{|\}\}/.test(consumedTemplate)) {
    throw createDomainError(
      "TEMPLATE_SCHEMA_INVALID",
      "Malformed placeholder syntax in active template.",
      502
    );
  }

  return placeholders;
}

const getDocumentTypeConfig = (documentType) => (
  SUPPORTED_DOCUMENT_TYPES.find((type) => type.document_type === documentType)
);

const requiredFieldsForTemplate = (placeholders) => {
  const fields = [...placeholders];

  if (!fields.includes("employee_id")) {
    fields.push("employee_id");
  }

  return fields;
};

const isCompanyContextField = (fieldName) => Object.hasOwn(COMPANY_FIELD_MAP, fieldName);

const isLaborLawField = (fieldName) => /(legal|law|statutory|mandatory)/i.test(fieldName);

const isCompanyPolicyField = (fieldName) => /policy/i.test(fieldName);

const isRagField = (fieldName) => isLaborLawField(fieldName) || isCompanyPolicyField(fieldName);

const selectUserSuppliedFields = (values, requiredFields) => {
  const result = {};

  for (const fieldName of requiredFields) {
    if (STRICT_COMPANY_FIELDS.has(fieldName) || isRagField(fieldName)) continue;

    if (hasValue(values[fieldName])) {
      result[fieldName] = values[fieldName];
    }
  }

  return result;
};

export function buildMissingFields(requiredFields, values) {
  return requiredFields
    .filter((fieldName) => !hasValue(values[fieldName]))
    .map(missingFieldFor);
}

const collectValuesFromMessages = (messages, requiredFields, options = {}) => {
  const collected = {};

  for (const message of messages) {
    if (message.role && message.role !== "user") continue;
    Object.assign(
      collected,
      extractFieldValuesFromMessage(message.content || "", requiredFields, options)
    );
  }

  return collected;
};

const getCompanyValues = async ({ requiredFields, aiContext, getCompanyContextFn }) => {
  const companyFields = requiredFields.filter(isCompanyContextField);
  if (companyFields.length === 0) return {};

  let companyContext;
  try {
    companyContext = await getCompanyContextFn(aiContext);
  } catch (error) {
    logger.error(`[DocumentGenerationService] Company context retrieval failed: ${error.message}`);
    throw createDomainError(
      "COMPANY_CONTEXT_UNAVAILABLE",
      "I could not retrieve the required company context for this document.",
      502
    );
  }

  const values = {};
  for (const fieldName of companyFields) {
    const contextKey = COMPANY_FIELD_MAP[fieldName];
    if (hasValue(companyContext?.[contextKey])) {
      values[fieldName] = companyContext[contextKey];
    }
  }

  return values;
};

const getKnowledgeValues = async ({ requiredFields, documentType, aiContext, retrieveKnowledgeFn }) => {
  const ragFields = requiredFields.filter(isRagField);
  if (ragFields.length === 0) {
    return { values: {}, sources: [] };
  }

  const values = {};
  const sources = [];

  const retrievalPlans = [];
  if (ragFields.some(isLaborLawField)) {
    retrievalPlans.push({ sourceType: "labor-law", fields: ragFields.filter(isLaborLawField) });
  }

  if (ragFields.some(isCompanyPolicyField)) {
    retrievalPlans.push({ sourceType: "company-policy", fields: ragFields.filter(isCompanyPolicyField) });
  }

  try {
    for (const plan of retrievalPlans) {
      const retrieval = await retrieveKnowledgeFn({
        query: `${documentType} ${plan.fields.join(" ")}`,
        context: {
          sourceType: plan.sourceType,
          companyId: plan.sourceType === "company-policy" ? aiContext.companyId : undefined,
          topK: 3,
        },
      });

      const chunks = Array.isArray(retrieval?.chunks) ? retrieval.chunks : [];
      const retrievedSources = Array.isArray(retrieval?.sources) ? retrieval.sources : [];
      sources.push(...retrievedSources.map((source) => SourceSchema.parse(source)));

      if (chunks.length === 0) continue;

      const groundedText = chunks
        .map((chunk) => chunk.content)
        .filter(hasValue)
        .join("\n\n");

      if (!hasValue(groundedText)) continue;

      for (const fieldName of plan.fields) {
        values[fieldName] = groundedText;
      }
    }
  } catch (error) {
    logger.error(`[DocumentGenerationService] Knowledge retrieval failed: ${error.message}`);
    throw createDomainError(
      "RAG_RETRIEVAL_FAILED",
      "I could not retrieve the required legal or policy knowledge for this document.",
      502
    );
  }

  return { values, sources };
};

export function renderTemplate(contentTemplate, values) {
  const rendered = contentTemplate.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (fullMatch, rawFieldName) => {
    const fieldName = rawFieldName.trim();

    if (!hasValue(values[fieldName])) {
      return fullMatch;
    }

    return escapeHtml(values[fieldName]);
  });

  if (/\{\{\s*[^{}]+?\s*\}\}/.test(rendered)) {
    throw createDomainError(
      "UNRESOLVED_PLACEHOLDERS",
      "Generated document still contains unresolved placeholders.",
      400
    );
  }

  if (rendered.trim().length === 0) {
    throw createDomainError(
      "DOCUMENT_GENERATION_FAILED",
      "Generated document content is empty.",
      500
    );
  }

  return rendered;
}

const buildDocumentTitle = (documentType, values) => {
  const config = getDocumentTypeConfig(documentType);
  const prefix = config?.title_prefix || `${documentType} Draft`;

  if (hasValue(values.employee_name)) {
    return `${prefix} - ${values.employee_name}`;
  }

  return `${prefix} Draft`;
};

const createMissingFieldsResult = (message, missingFields) => ({
  success: true,
  status: "missing_fields",
  message,
  missing_fields: missingFields,
  sources: [],
});

const createErrorResult = (error, fallbackMessage = "I could not complete the document generation request.") => ({
  success: false,
  status: "error",
  message: error?.message || fallbackMessage,
  error: {
    code: error?.code || "DOCUMENT_GENERATION_FAILED",
    status: error?.status || 500,
  },
  sources: [],
});

const normalizeConversationMessages = async ({ message, aiContext, conversationMessages, getConversationHistoryFn }) => {
  if (conversationMessages) {
    return [...conversationMessages, { role: "user", content: message }];
  }

  if (!aiContext.conversationId) {
    return [{ role: "user", content: message }];
  }

  try {
    const history = await getConversationHistoryFn(
      aiContext.conversationId,
      aiContext,
      1,
      MAX_HISTORY_MESSAGES
    );

    const messages = Array.isArray(history?.messages) ? history.messages : [];
    const hasCurrentMessage = messages.some((candidate) => (
      candidate.role === "user" && candidate.content === message
    ));

    return hasCurrentMessage
      ? messages
      : [...messages, { role: "user", content: message }];
  } catch (error) {
    logger.error(`[DocumentGenerationService] Conversation history retrieval failed: ${error.message}`);
    throw createDomainError(
      "CONVERSATION_HISTORY_UNAVAILABLE",
      "I could not retrieve the conversation context needed to continue this document.",
      500
    );
  }
};

const mapTemplateRetrievalError = (error, documentType) => {
  if (error?.code) return error;

  if (/not found/i.test(error?.message || "")) {
    return createDomainError(
      "TEMPLATE_NOT_FOUND",
      `I could not find an active template for ${documentType}.`,
      404
    );
  }

  if (/invalid template response/i.test(error?.message || "")) {
    return createDomainError(
      "TEMPLATE_SCHEMA_INVALID",
      "The active template response from the backend is invalid.",
      502
    );
  }

  return createDomainError(
    "TEMPLATE_RETRIEVAL_FAILED",
    "I could not retrieve the active document template.",
    502
  );
};

const createSaveError = (error) => {
  logger.error(`[DocumentGenerationService] Document save failed: ${error.message}`);
  return createDomainError(
    "DOCUMENT_SAVE_FAILED",
    "I generated the document content, but could not save the draft.",
    502
  );
};

/**
 * Generates a document draft through the finalized AI Server -> .NET contracts.
 *
 * @param {Object} input
 * @param {string} input.message
 * @param {import("../contracts/index.js").AIContext} input.aiContext
 * @param {Array<Object>} [input.conversationMessages]
 * @param {Object} [dependencies]
 * @returns {Promise<Object>}
 */
export async function generateDocument(input, dependencies = {}) {
  const parsed = DocumentGenerationInputSchema.safeParse(input);
  if (!parsed.success) {
    return createErrorResult(createDomainError(
      "DOCUMENT_REQUEST_INVALID",
      "The document generation request is missing required context.",
      400
    ));
  }

  const {
    getActiveTemplateFn = getActiveTemplate,
    saveDocumentFn = saveDocument,
    getCompanyContextFn = getCompanyContext,
    getConversationHistoryFn = getHistory,
    retrieveKnowledgeFn = retrieveKnowledge,
    baseDate = new Date(),
  } = dependencies;

  const { message, aiContext, conversationMessages } = parsed.data;

  try {
    const messages = await normalizeConversationMessages({
      message,
      aiContext,
      conversationMessages,
      getConversationHistoryFn,
    });

    const documentTypeResolution = resolveDocumentTypeFromMessages(messages);

    if (documentTypeResolution.unsupported) {
      return createErrorResult(createDomainError(
        "UNSUPPORTED_DOCUMENT_TYPE",
        `I can only generate ${SUPPORTED_DOCUMENT_TYPES.map((type) => type.label).join(", ")} drafts right now.`,
        400
      ));
    }

    if (documentTypeResolution.missing) {
      return createMissingFieldsResult(
        "I can generate a document draft, but I need the document type first.",
        [missingFieldFor("document_type")]
      );
    }

    const { documentType } = documentTypeResolution;

    let template;
    try {
      template = await getActiveTemplateFn(aiContext, documentType);
    } catch (error) {
      return createErrorResult(mapTemplateRetrievalError(error, documentType));
    }

    if (template.document_type !== documentType) {
      return createErrorResult(createDomainError(
        "TEMPLATE_DOCUMENT_TYPE_MISMATCH",
        "The active template does not match the requested document type.",
        502
      ));
    }

    const placeholders = extractPlaceholders(template.content_template);
    const requiredFields = requiredFieldsForTemplate(placeholders);

    const collectedUserValues = collectValuesFromMessages(messages, requiredFields, { baseDate });
    const userValues = selectUserSuppliedFields(collectedUserValues, requiredFields);
    const companyValues = await getCompanyValues({
      requiredFields,
      aiContext,
      getCompanyContextFn,
    });
    const knowledge = await getKnowledgeValues({
      requiredFields,
      documentType,
      aiContext,
      retrieveKnowledgeFn,
    });

    const values = {
      ...companyValues,
      ...userValues,
      ...knowledge.values,
    };

    const missingFields = buildMissingFields(requiredFields, values);
    if (missingFields.length > 0) {
      return createMissingFieldsResult(
        "I can create that draft, but I need a few required fields first.",
        missingFields
      );
    }

    const contentHtml = renderTemplate(template.content_template, values);
    const title = buildDocumentTitle(documentType, values);

    let saveResponse;
    try {
      saveResponse = await saveDocumentFn(aiContext, {
        document_type: template.document_type,
        title,
        content_html: contentHtml,
        employee_id: String(values.employee_id),
        template_id: template.template_id || undefined,
        metadata: {
          template_name: template.name,
          filled_fields: values,
          placeholders,
        },
      });
    } catch (error) {
      return createErrorResult(createSaveError(error));
    }

    const resultCard = ResultCardSchema.parse({
      type: "document_draft",
      doc_id: saveResponse.document_id,
      doc_type: saveResponse.document_type,
      employee_id: String(values.employee_id),
      employee_name: hasValue(values.employee_name) ? String(values.employee_name) : undefined,
    });

    return {
      success: true,
      status: "saved",
      message: `I've created and saved ${title} as a draft.`,
      sources: knowledge.sources,
      result_card: resultCard,
      document: {
        document_id: saveResponse.document_id,
        document_type: saveResponse.document_type,
        status: saveResponse.status,
        created_at: saveResponse.created_at,
        title,
        template_id: template.template_id,
      },
    };
  } catch (error) {
    return createErrorResult(error);
  }
}
