import { z } from "zod";
import { getActiveTemplate } from "../integrations/wakeel/template-api.js";
import { saveDocument } from "../integrations/wakeel/document-api.js";
import { getCompanyContext } from "./company-context.service.js";
import { getEmployeeContext } from "./employee-context.service.js";
import { getHistory } from "./chat-history.service.js";
import { retrieveKnowledge } from "../rag/retrieval/knowledge-retrieval.service.js";
import { generateLegalClause } from "../llm/legal-clause-generator.js";
import {
  MissingFieldSchema,
  ResultCardSchema,
  SourceSchema,
} from "../contracts/index.js";
import { logger } from "../shared/logger.js";
import { normalizeArabic, containsArabic } from "../shared/arabic-utils.js";

const CONTRACT_DOCUMENT_TYPE = "Contract";
const WARNING_DOCUMENT_TYPE = "Warning_Letter";
const TERMINATION_DOCUMENT_TYPE = "Termination_Letter";
const MAX_HISTORY_MESSAGES = 50;

export const SUPPORTED_DOCUMENT_TYPES = Object.freeze([
  {
    document_type: CONTRACT_DOCUMENT_TYPE,
    label: "Employment Contract",
    title_prefix: "Employment Contract",
    aliases: [
      "contract",
      "employment contract",
      "employment_contract",
      "عقد",
      "عقد عمل",
      "عقد توظيف",
      "عقد العمل",
    ],
  },
  {
    document_type: WARNING_DOCUMENT_TYPE,
    label: "Warning Letter",
    title_prefix: "Warning Letter",
    aliases: [
      "warning",
      "warning letter",
      "warning_letter",
      "انذار",
      "إنذار",
      "خطاب انذار",
      "خطاب إنذار",
      "جواب انذار",
    ],
  },
  {
    document_type: TERMINATION_DOCUMENT_TYPE,
    label: "Termination Letter",
    title_prefix: "Termination Letter",
    aliases: [
      "termination",
      "termination letter",
      "termination_letter",
      "انهاء خدمة",
      "إنهاء خدمة",
      "خطاب انهاء خدمة",
      "خطاب إنهاء خدمة",
      "فصل",
      "خطاب فصل",
    ],
  },
]);

const UNSUPPORTED_DOCUMENT_TYPE_KEYWORDS = Object.freeze([
  {
    document_type: "NDA",
    keyword: /\b(nda|non[- ]disclosure|non disclosure)\b|عدم\s+افصاح|عدم\s+إفصاح|سرية\s+المعلومات/iu,
  },
  {
    document_type: "Certificate",
    keyword: /\b(certificate|experience letter|recommendation letter)\b|شهادة\s+خبرة|شهادة\s+خبره|خطاب\s+توصية/iu,
  },
]);

const AI_GENERATED_PLACEHOLDER_PREFIXES = Object.freeze({
  legal_clause: Object.freeze(["labor-law"]),
  policy_clause: Object.freeze(["company-policy"]),
  legal_policy_clause: Object.freeze(["labor-law", "company-policy"]),
  legal_and_policy_clause: Object.freeze(["labor-law", "company-policy"]),
});

const LEGACY_AI_GENERATED_PLACEHOLDERS = Object.freeze({
  legal_clause: Object.freeze(["labor-law"]),
  policy_clause: Object.freeze(["company-policy"]),
});

const MAX_GENERATED_CLAUSE_CHARACTERS = 3000;

const COMPANY_FIELD_MAP = Object.freeze({
  company_name: "companyName",
  company_id: "companyId",
  company_tax_id: "taxId",
  tax_id: "taxId",
  industry: "industry",
  company_industry: "industry",
  address: "address",
  company_address: "address",
  phone_number: "phoneNumber",
  phone: "phoneNumber",
  company_phone: "phoneNumber",
  email: "email",
  company_email: "email",
  logo_url: "logoUrl",
  working_hours: "workingHours",
  company_working_hours: "workingHours",
  registered_at: "registeredAt",
  registered_date: "registeredAt",
});

const STRICT_COMPANY_FIELDS = Object.freeze(
  new Set([
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
  ]),
);

const COMMON_FIELD_PATTERNS = Object.freeze({
  employee_id: [
    /\bemployee\s*(?:id|number)\s*(?:is|=|:)\s*([A-Za-z0-9_-]+)/i,
    /\bemp(?:loyee)?\s*#\s*([A-Za-z0-9_-]+)/i,
    /(?:رقم\s+الموظف|كود\s+الموظف)\s*(?:هو|=|:)\s*([A-Za-z0-9_-]+)/iu,
  ],
  employee_name: [
    /\bemployee\s+name\s*(?:is|=|:)\s*([^,.;\n]+)/i,
    /\bname\s*(?:is|=|:)\s*([^,.;\n]+)/i,
    // Do not match to end-of-string: without a real terminator, the regex can
    // greedily consume the rest of the sentence and incorrectly satisfy the
    // employee_name requirement.
    /\bfor\s+([^,.;\n]+?)(?=\s+(?:as|with|starting|start|salary)\b|[,.;])/i,
    /(?:اسم\s+الموظف|اسم\s+الموظفة|الموظف|الموظفة)\s*(?:هو|هي|=|:)\s*([^,.;\n]+)/iu,
    /(?:لـ|للموظف|للموظفة)\s+([^,.;\n]+?)(?=\s+(?:بوظيفة|بمرتب|براتب|تاريخ|من|اعتبارا)|[,.;]|$)/iu,
  ],
  job_title: [
    /\b(?:job\s*title|position|role)\s*(?:is|=|:)\s*([^,.;\n]+)/i,
    /\bas\s+(?:a\s+|an\s+)?([^,.;\n]+?)(?=\s+(?:with\s+salary|salary|starting|start(?:\s+date)?|from)|[,.;]|$)/i,
    /(?:المسمى\s+الوظيفي|الوظيفة|المنصب|بوظيفة|كـ)\s*(?:هو|هي|=|:)?\s*([^,.;\n]+?)(?=\s+(?:بمرتب|براتب|تاريخ|من|ساعات)|[,.;]|$)/iu,
  ],
  salary: [
    /\b(?:salary|wage|compensation)\s*(?:is|=|:)?\s*(?:egp|e\.g\.p\.|\$)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i,
    /(?:المرتب|الراتب|بمرتب|براتب|أجر|اجر)\s*(?:هو|=|:)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:جنيه|ج\.م|egp)?/iu,
  ],
  start_date: [
    /\b(?:start(?:ing)?(?:\s+date)?|starts(?:\s+on)?|from)\s*(?:is|=|:|on)?\s*([A-Za-z]+\s+\d{1,2}(?:,\s*\d{4})?|\d{1,2}\s+[A-Za-z]+(?:\s+\d{4})?|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /(?:تاريخ\s+البدء|تاريخ\s+التعيين|يبدأ\s+من|اعتبارا\s+من|من\s+تاريخ)\s*(?:هو|=|:)?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}\s+[^\s,.;]+\s+\d{4})/iu,
  ],
  working_hours: [
    /\b(?:working\s+hours|work\s+hours|hours)\s*(?:are|is|=|:)\s*([^,.;\n]+)/i,
    /(?:ساعات\s+العمل|مواعيد\s+العمل)\s*(?:هي|=|:)\s*([^,.;\n]+)/iu,
  ],
  document_type: [
    /\bdocument\s*type\s*(?:is|=|:)\s*([^,.;\n]+)/i,
    /(?:نوع\s+المستند|نوع\s+الوثيقة|نوع\s+العقد)\s*(?:هو|=|:)\s*([^,.;\n]+)/iu,
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

const DocumentGenerationInputSchema = z
  .object({
    message: z.string().trim().min(1),
    aiContext: z
      .object({
        userId: z.string().trim().min(1),
        companyId: z.string().trim().min(1),
        role: z.string().trim().min(1),
        conversationId: z.string().trim().min(1).optional(),
        targetEmployeeId: z.string().trim().min(1).optional(),
      })
      .passthrough(),
    conversationMessages: z
      .array(
        z
          .object({
            role: z.string().optional(),
            content: z.string(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .strict();

const createDomainError = (code, message, status = 400) => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
};

const hasValue = (value) =>
  value !== undefined && value !== null && String(value).trim().length > 0;

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const titleCase = (fieldName) =>
  fieldName
    .split("_")
    .map((word) =>
      LABEL_ACRONYMS.has(word.toLowerCase())
        ? word.toUpperCase()
        : `${word.charAt(0).toUpperCase()}${word.slice(1)}`,
    )
    .join(" ");

const inputTypeForField = (fieldName) => {
  if (fieldName === "document_type") return "dropdown";
  if (/date|registered_at/i.test(fieldName)) return "date";
  if (/salary|amount|number|days|hours_count|duration/i.test(fieldName))
    return "number";
  return "text";
};

const missingFieldFor = (fieldName) =>
  MissingFieldSchema.parse({
    field_name: fieldName,
    input_type: inputTypeForField(fieldName),
    label: titleCase(fieldName),
    options:
      fieldName === "document_type"
        ? SUPPORTED_DOCUMENT_TYPES.map((type) => type.document_type)
        : [],
  });

const normalizeWhitespace = (value) =>
  String(value).replace(/\s+/g, " ").trim();

const trimExtractedValue = (value) =>
  normalizeWhitespace(value)
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

  const monthDayMatch = trimmed.match(
    /^([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?$/,
  );
  if (monthDayMatch) {
    const [, monthName, rawDay, rawYear] = monthDayMatch;
    const month = MONTHS[monthName.toLowerCase()];
    if (month) {
      const year = rawYear || String(baseDate.getFullYear());
      return `${year}-${month}-${rawDay.padStart(2, "0")}`;
    }
  }

  const dayMonthMatch = trimmed.match(
    /^(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?$/,
  );
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

const labelPatternForField = (fieldName) =>
  escapeRegex(fieldName).replace(/_/g, "\\s+");

const fieldMatchesRequestedSet = (fieldName, requestedFieldNames) =>
  requestedFieldNames.has(fieldName) || fieldName === "document_type";

export function extractFieldValuesFromMessage(
  message,
  fieldNames = [],
  options = {},
) {
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
    const pattern = new RegExp(
      `\\b${labelPatternForField(fieldName)}\\b\\s*(?:is|are|=|:)\\s*([^,.;\\n]+)`,
      "i",
    );
    const match = message.match(pattern);
    if (match?.[1]) {
      values[fieldName] = normalizeFieldValue(fieldName, match[1], options);
    }
  }

  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => hasValue(value)),
  );
}

const normalizeDocumentType = (value) => {
  const normalized = normalizeWhitespace(value)
    .toLowerCase()
    .replace(/-/g, "_");

  for (const type of SUPPORTED_DOCUMENT_TYPES) {
    if (
      normalized === type.document_type.toLowerCase() ||
      type.aliases.some((alias) => normalized === alias.toLowerCase())
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

export function resolveDocumentTypeFromMessages(messages, aiContext = {}) {
  // 1. Direct resolution from aiContext structured field_values or properties
  const contextDocType =
    aiContext?.field_values?.document_type ||
    aiContext?.field_values?.documentType ||
    aiContext?.document_type ||
    aiContext?.documentType;

  if (contextDocType) {
    const explicit = normalizeDocumentType(contextDocType);
    if (explicit) return explicit;
  }

  // 2. Text extraction from conversation messages
  const combinedText = (messages || [])
    .map((message) => message.content || "")
    .join("\n");
  const extracted = extractFieldValuesFromMessage(combinedText, [
    "document_type",
  ]);

  if (extracted.document_type) {
    const explicit = normalizeDocumentType(extracted.document_type);
    if (explicit) return explicit;
  }

  const normArCombined = normalizeArabic(combinedText);

  for (const type of SUPPORTED_DOCUMENT_TYPES) {
    if (
      type.aliases.some((alias) => {
        if (containsArabic(alias)) {
          const normAlias = normalizeArabic(alias.replace(/_/g, " "));
          return (
            normArCombined.includes(normAlias) ||
            new RegExp(
              `(?:^|\\s|[.,!?;])${escapeRegex(normAlias)}(?:$|\\s|[.,!?;])`,
              "iu",
            ).test(normArCombined)
          );
        }
        return new RegExp(
          `\\b${escapeRegex(alias.replace(/_/g, " "))}\\b`,
          "i",
        ).test(combinedText);
      })
    ) {
      return { documentType: type.document_type };
    }
  }

  for (const unsupported of UNSUPPORTED_DOCUMENT_TYPE_KEYWORDS) {
    if (unsupported.keyword.test(combinedText) || unsupported.keyword.test(normArCombined)) {
      return {
        unsupported: true,
        documentType: unsupported.document_type,
      };
    }
  }

  return { missing: true };
}

const getClauseSourceTypeLabel = (sourceTypes) => {
  if (sourceTypes.length === 2) return "labor_law_and_company_policy";
  return sourceTypes[0] === "labor-law" ? "labor_law" : "company_policy";
};

const parsePlaceholderToken = (token) => {
  const fieldName = token.trim();
  const aiMatch = fieldName.match(
    /^([A-Za-z][A-Za-z0-9_]*):([A-Za-z][A-Za-z0-9_]*)$/,
  );

  if (aiMatch) {
    const [, prefix, clauseKey] = aiMatch;
    const sourceTypes = AI_GENERATED_PLACEHOLDER_PREFIXES[prefix];

    if (!sourceTypes) {
      throw createDomainError(
        "TEMPLATE_SCHEMA_INVALID",
        `Invalid AI-generated placeholder: ${fieldName}`,
        502,
      );
    }

    return {
      name: fieldName,
      kind: "ai_generated",
      placeholder_type: prefix,
      clause_key: clauseKey,
      source_types: [...sourceTypes],
      source_type: getClauseSourceTypeLabel(sourceTypes),
      description: `Generate the ${clauseKey.replace(/_/g, " ")} clause`,
    };
  }

  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(fieldName)) {
    throw createDomainError(
      "TEMPLATE_SCHEMA_INVALID",
      `Invalid placeholder name: ${fieldName}`,
      502,
    );
  }

  const legacySourceTypes = LEGACY_AI_GENERATED_PLACEHOLDERS[fieldName];
  if (legacySourceTypes) {
    return {
      name: fieldName,
      kind: "ai_generated",
      placeholder_type: fieldName,
      clause_key: fieldName,
      source_types: [...legacySourceTypes],
      source_type: getClauseSourceTypeLabel(legacySourceTypes),
      description: `Generate the ${fieldName.replace(/_/g, " ")} clause`,
    };
  }

  return {
    name: fieldName,
    kind: "input",
  };
};

export function parseTemplatePlaceholders(contentTemplate) {
  if (
    typeof contentTemplate !== "string" ||
    contentTemplate.trim().length === 0
  ) {
    throw createDomainError(
      "TEMPLATE_SCHEMA_INVALID",
      "The active template has no usable HTML content.",
      502,
    );
  }

  const placeholders = [];
  const placeholderPattern = /\{\{\s*([^{}]+?)\s*\}\}/g;
  const consumedTemplate = contentTemplate.replace(
    placeholderPattern,
    (fullMatch, rawFieldName) => {
      const placeholder = parsePlaceholderToken(rawFieldName);

      if (
        !placeholders.some((candidate) => candidate.name === placeholder.name)
      ) {
        placeholders.push(placeholder);
      }

      return "";
    },
  );

  if (/\{\{|\}\}/.test(consumedTemplate)) {
    throw createDomainError(
      "TEMPLATE_SCHEMA_INVALID",
      "Malformed placeholder syntax in active template.",
      502,
    );
  }

  return placeholders;
}

export function extractPlaceholders(contentTemplate) {
  return parseTemplatePlaceholders(contentTemplate).map(
    (placeholder) => placeholder.name,
  );
}

const getDocumentTypeConfig = (documentType) =>
  SUPPORTED_DOCUMENT_TYPES.find((type) => type.document_type === documentType);

const requiredFieldsForTemplate = (placeholders) => {
  return [...placeholders];
};

const isCompanyContextField = (fieldName) =>
  Object.hasOwn(COMPANY_FIELD_MAP, fieldName);

const clauseRequiresCompanyPolicy = (placeholder) =>
  placeholder.source_types.includes("company-policy");

const selectUserSuppliedFields = (values, requiredFields) => {
  const result = {};

  for (const fieldName of requiredFields) {
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
      extractFieldValuesFromMessage(
        message.content || "",
        requiredFields,
        options,
      ),
    );
  }

  return collected;
};

const getCompanyContextAndValues = async ({
  requiredFields,
  aiGeneratedPlaceholders,
  aiContext,
  getCompanyContextFn,
}) => {
  const companyFields = requiredFields.filter(isCompanyContextField);
  const needsCompanyContext =
    companyFields.length > 0 ||
    aiGeneratedPlaceholders.some(clauseRequiresCompanyPolicy);

  if (!needsCompanyContext) {
    return { values: {}, context: null };
  }

  let companyContext;
  try {
    companyContext = await getCompanyContextFn(aiContext);
  } catch (error) {
    logger.error(
      `[DocumentGenerationService] Company context retrieval failed: ${error.message}`,
    );
    throw createDomainError(
      "COMPANY_CONTEXT_UNAVAILABLE",
      "I could not retrieve the required company context for this document.",
      502,
    );
  }

  const values = {};
  for (const fieldName of companyFields) {
    const contextKey = COMPANY_FIELD_MAP[fieldName];
    if (hasValue(companyContext?.[contextKey])) {
      values[fieldName] = companyContext[contextKey];
    }
  }

  return { values, context: companyContext };
};

const EMPLOYEE_FIELD_MAP = Object.freeze({
  employee_name: "full_name",
  job_title: "job_title",
  department: "department",
});

const isEmployeeContextField = (fieldName) =>
  Object.hasOwn(EMPLOYEE_FIELD_MAP, fieldName);

const getEmployeeContextAndValues = async ({
  requiredFields,
  aiContext,
  getEmployeeContextFn,
}) => {
  const employeeFields = requiredFields.filter(isEmployeeContextField);

  if (employeeFields.length === 0) {
    return { values: {}, context: null };
  }

  let employeeContext;
  try {
    employeeContext = await getEmployeeContextFn(aiContext);
  } catch (error) {
    logger.warn(
      `[DocumentGenerationService] Employee context retrieval failed (likely HR manager without profile): ${error.message}`,
    );
    return { values: {}, context: null };
  }

  const values = {};
  for (const fieldName of employeeFields) {
    const contextKey = EMPLOYEE_FIELD_MAP[fieldName];
    if (hasValue(employeeContext?.[contextKey])) {
      values[fieldName] = employeeContext[contextKey];
    }
  }

  return { values, context: employeeContext };
};

const buildEmployeeContextFromValues = (values, targetEmployeeId) => {
  const context = {
    employee_name: values.employee_name,
    job_title: values.job_title,
    salary: values.salary,
    start_date: values.start_date,
    working_hours: values.working_hours,
  };

  const employeeId = targetEmployeeId || values.employee_id;
  if (hasValue(employeeId)) {
    context.employee_id = employeeId;
  }

  return context;
};

const buildClauseRetrievalQuery = ({
  placeholder,
  sourceType,
  documentType,
  values,
  companyContext,
}) => {
  const clausePurpose = placeholder.clause_key.replace(/_/g, " ");
  const sourceFocus =
    sourceType === "labor-law" ? "Egyptian labor law" : "company policy";

  return [
    sourceFocus,
    documentType,
    clausePurpose,
    values.job_title,
    values.working_hours,
    companyContext?.industry,
  ]
    .filter(hasValue)
    .join(" ");
};

const formatClauseSources = ({ sources, placeholder, sourceType }) =>
  sources.map((source) =>
    SourceSchema.parse({
      ...source,
      type: source.type || sourceType,
      metadata: {
        ...(source.metadata || {}),
        clause_id: placeholder.name,
        clause_key: placeholder.clause_key,
        clause_placeholder_type: placeholder.placeholder_type,
        clause_source_type: sourceType,
      },
    }),
  );

const hasSufficientRetrievedSupport = ({ chunks, sources }) =>
  chunks.some((chunk) => hasValue(chunk?.content)) && sources.length > 0;

const retrieveClauseKnowledge = async ({
  placeholder,
  documentType,
  values,
  companyContext,
  aiContext,
  retrieveKnowledgeFn,
}) => {
  const chunks = [];
  const sources = [];
  const supportBySourceType = {};

  try {
    for (const knowledgeType of placeholder.source_types) {
      const retrieval = await retrieveKnowledgeFn({
        query: buildClauseRetrievalQuery({
          placeholder,
          sourceType: knowledgeType,
          documentType,
          values,
          companyContext,
        }),
        context: {
          knowledgeType,
          companyId:
            knowledgeType === "company-policy"
              ? aiContext.companyId
              : undefined,
          topK: 3,
        },
      });

      const retrievedChunks = Array.isArray(retrieval?.chunks)
        ? retrieval.chunks
        : [];
      const retrievedSources = Array.isArray(retrieval?.sources)
        ? retrieval.sources
        : [];

      chunks.push(...retrievedChunks);
      const formattedSources = formatClauseSources({
        sources: retrievedSources,
        placeholder,
        sourceType: knowledgeType,
      });
      sources.push(...formattedSources);
      supportBySourceType[knowledgeType] = hasSufficientRetrievedSupport({
        chunks: retrievedChunks,
        sources: formattedSources,
      });
    }
  } catch (error) {
    logger.error(
      `[DocumentGenerationService] Knowledge retrieval failed: ${error.message}`,
    );
    throw createDomainError(
      "RAG_RETRIEVAL_FAILED",
      "I could not retrieve the required legal or policy knowledge for this document.",
      502,
    );
  }

  const hasSupportForEverySourceType = placeholder.source_types.every(
    (sourceType) => supportBySourceType[sourceType],
  );

  if (
    !hasSupportForEverySourceType ||
    !hasSufficientRetrievedSupport({ chunks, sources })
  ) {
    throw createDomainError(
      "INSUFFICIENT_SOURCE_SUPPORT",
      `I could not find enough retrieved source support to generate ${placeholder.name}.`,
      424,
    );
  }

  return { chunks, sources };
};

const sourceTextFor = (sources) =>
  sources
    .map((source) => source.content)
    .filter(hasValue)
    .join("\n");

const documentValueTextFor = (values) =>
  Object.values(values).filter(hasValue).join(" ");

const extractNumbers = (text) => String(text).match(/\b\d+(?:\.\d+)?\b/g) || [];

const hasUnsupportedNumericClaim = ({ clause, sources, values }) => {
  const supportText = `${sourceTextFor(sources)} ${documentValueTextFor(values)}`;
  const uniqueNumbers = [...new Set(extractNumbers(clause))];

  return uniqueNumbers.some((number) => !supportText.includes(number));
};

const validateGeneratedClause = ({
  generatedClause,
  placeholder,
  sources,
  values,
}) => {
  if (generatedClause.support !== "supported") {
    throw createDomainError(
      "INSUFFICIENT_SOURCE_SUPPORT",
      `Retrieved sources were insufficient to generate ${placeholder.name}.`,
      424,
    );
  }

  const clause = generatedClause.clause?.trim();
  if (!hasValue(clause)) {
    throw createDomainError(
      "CLAUSE_GENERATION_FAILED",
      `The generated clause for ${placeholder.name} was empty.`,
      502,
    );
  }

  if (clause.length > MAX_GENERATED_CLAUSE_CHARACTERS) {
    throw createDomainError(
      "GENERATED_CLAUSE_VALIDATION_FAILED",
      `The generated clause for ${placeholder.name} was too long.`,
      502,
    );
  }

  if (/\{\{|\}\}/.test(clause)) {
    throw createDomainError(
      "GENERATED_CLAUSE_VALIDATION_FAILED",
      `The generated clause for ${placeholder.name} contains unsupported placeholders.`,
      502,
    );
  }

  if (/<\s*(html|body|h1)\b/i.test(clause)) {
    throw createDomainError(
      "GENERATED_CLAUSE_VALIDATION_FAILED",
      `The generated clause for ${placeholder.name} appears to contain document-level markup.`,
      502,
    );
  }

  if (
    /(according to the ai|retrieved documents say|provided sources say|as an ai|source id|citation)/i.test(
      clause,
    )
  ) {
    throw createDomainError(
      "GENERATED_CLAUSE_VALIDATION_FAILED",
      `The generated clause for ${placeholder.name} contains unsupported meta-language.`,
      502,
    );
  }

  const availableSourceIds = new Set(sources.map((source) => source.id));
  const sourceIds = Array.isArray(generatedClause.source_ids)
    ? generatedClause.source_ids
    : [];

  if (
    sourceIds.length === 0 ||
    sourceIds.some((sourceId) => !availableSourceIds.has(sourceId))
  ) {
    throw createDomainError(
      "GENERATED_CLAUSE_VALIDATION_FAILED",
      `The generated clause for ${placeholder.name} does not cite retrieved sources.`,
      502,
    );
  }

  const usedSources = sources.filter((source) => sourceIds.includes(source.id));
  if (hasUnsupportedNumericClaim({ clause, sources: usedSources, values })) {
    throw createDomainError(
      "GENERATED_CLAUSE_UNSUPPORTED_CONTENT",
      `The generated clause for ${placeholder.name} contains a numeric claim not supported by sources or document values.`,
      502,
    );
  }

  return {
    content: clause,
    source_ids: [...new Set(sourceIds)],
    sources: usedSources,
  };
};

const generateAiClauseValues = async ({
  aiGeneratedPlaceholders,
  documentType,
  values,
  companyContext,
  aiContext,
  retrieveKnowledgeFn,
  generateLegalClauseFn,
}) => {
  if (aiGeneratedPlaceholders.length === 0) {
    return { values: {}, sources: [], generatedClauses: [] };
  }

  const clauseValues = {};
  const sources = [];
  const generatedClauses = [];
  const employeeContext = buildEmployeeContextFromValues(values, aiContext?.targetEmployeeId);

  for (const placeholder of aiGeneratedPlaceholders) {
    const retrieved = await retrieveClauseKnowledge({
      placeholder,
      documentType,
      values,
      companyContext,
      aiContext,
      retrieveKnowledgeFn,
    });

    let generatedClause;
    try {
      generatedClause = await generateLegalClauseFn({
        clause: placeholder,
        documentType,
        documentValues: values,
        companyContext,
        employeeContext,
        chunks: retrieved.chunks,
        sources: retrieved.sources,
      });
    } catch (error) {
      logger.error(
        `[DocumentGenerationService] Clause generation failed: ${error.message}`,
      );
      throw createDomainError(
        "CLAUSE_GENERATION_FAILED",
        `I could not generate ${placeholder.name} from the retrieved sources.`,
        502,
      );
    }

    const validatedClause = validateGeneratedClause({
      generatedClause,
      placeholder,
      sources: retrieved.sources,
      values,
    });

    clauseValues[placeholder.name] = validatedClause.content;
    sources.push(...validatedClause.sources);
    generatedClauses.push({
      clause_id: placeholder.name,
      clause_key: placeholder.clause_key,
      placeholder_type: placeholder.placeholder_type,
      source_type: placeholder.source_type,
      content: validatedClause.content,
      source_ids: validatedClause.source_ids,
      sources: validatedClause.sources.map((source) => ({
        id: source.id,
        title: source.title,
        type: source.type,
        metadata: source.metadata || {},
      })),
    });
  }

  return {
    values: clauseValues,
    sources,
    generatedClauses,
  };
};

export function renderTemplate(contentTemplate, values) {
  const rendered = contentTemplate.replace(
    /\{\{\s*([^{}]+?)\s*\}\}/g,
    (fullMatch, rawFieldName) => {
      const fieldName = rawFieldName.trim();

      if (!hasValue(values[fieldName])) {
        return fullMatch;
      }

      return escapeHtml(values[fieldName]);
    },
  );

  if (/\{\{\s*[^{}]+?\s*\}\}/.test(rendered)) {
    throw createDomainError(
      "UNRESOLVED_PLACEHOLDERS",
      "Generated document still contains unresolved placeholders.",
      400,
    );
  }

  if (rendered.trim().length === 0) {
    throw createDomainError(
      "DOCUMENT_GENERATION_FAILED",
      "Generated document content is empty.",
      500,
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

const createErrorResult = (
  error,
  fallbackMessage = "I could not complete the document generation request.",
) => ({
  success: false,
  status: "error",
  message: error?.message || fallbackMessage,
  error: {
    code: error?.code || "DOCUMENT_GENERATION_FAILED",
    status: error?.status || 500,
  },
  sources: [],
});

const normalizeConversationMessages = async ({
  message,
  aiContext,
  conversationMessages,
  getConversationHistoryFn,
}) => {
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
      MAX_HISTORY_MESSAGES,
    );

    const messages = Array.isArray(history?.messages) ? history.messages : [];
    const hasCurrentMessage = messages.some(
      (candidate) => candidate.role === "user" && candidate.content === message,
    );

    return hasCurrentMessage
      ? messages
      : [...messages, { role: "user", content: message }];
  } catch (error) {
    logger.error(
      `[DocumentGenerationService] Conversation history retrieval failed: ${error.message}`,
    );
    throw createDomainError(
      "CONVERSATION_HISTORY_UNAVAILABLE",
      "I could not retrieve the conversation context needed to continue this document.",
      500,
    );
  }
};

const mapTemplateRetrievalError = (error, documentType) => {
  if (error?.code) return error;

  if (/not found/i.test(error?.message || "")) {
    return createDomainError(
      "TEMPLATE_NOT_FOUND",
      `I could not find an active template for ${documentType}.`,
      404,
    );
  }

  if (/invalid template response/i.test(error?.message || "")) {
    return createDomainError(
      "TEMPLATE_SCHEMA_INVALID",
      "The active template response from the backend is invalid.",
      502,
    );
  }

  return createDomainError(
    "TEMPLATE_RETRIEVAL_FAILED",
    "I could not retrieve the active document template.",
    502,
  );
};

const createSaveError = (error) => {
  logger.error(
    `[DocumentGenerationService] Document save failed: ${error.message}`,
  );
  return createDomainError(
    "DOCUMENT_SAVE_FAILED",
    "I generated the document content, but could not save the draft.",
    502,
  );
};

const buildDocumentSavePayload = ({
  template,
  title,
  contentHtml,
  finalValues,
  placeholders,
  placeholderSpecs,
  generatedClauses,
  targetEmployeeId,
}) => {
  const payload = {
    document_type: template.document_type,
    title,
    content_html: contentHtml,
    template_id: template.template_id || undefined,
    metadata: {
      template_name: template.name,
      filled_fields: finalValues,
      placeholders,
      placeholder_specs: placeholderSpecs,
      generated_clauses: generatedClauses,
    },
  };

  const employeeId = targetEmployeeId || finalValues.employee_id;
  if (hasValue(employeeId)) {
    payload.employee_id = String(employeeId);
  }

  return payload;
};

const buildDocumentDraftResultCard = ({ saveResponse, finalValues, targetEmployeeId }) => {
  const resultCard = {
    type: "document_draft",
    doc_id: saveResponse.document_id,
    doc_type: saveResponse.document_type,
    employee_name: hasValue(finalValues.employee_name)
      ? String(finalValues.employee_name)
      : undefined,
  };

  const employeeId = targetEmployeeId || finalValues.employee_id;
  if (hasValue(employeeId)) {
    resultCard.employee_id = String(employeeId);
  }

  return ResultCardSchema.parse(resultCard);
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
    return createErrorResult(
      createDomainError(
        "DOCUMENT_REQUEST_INVALID",
        "The document generation request is missing required context.",
        400,
      ),
    );
  }

  const {
    getActiveTemplateFn = getActiveTemplate,
    saveDocumentFn = saveDocument,
    getCompanyContextFn = getCompanyContext,
    getEmployeeContextFn = getEmployeeContext,
    getConversationHistoryFn = getHistory,
    retrieveKnowledgeFn = retrieveKnowledge,
    generateLegalClauseFn = generateLegalClause,
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

    if (!hasValue(aiContext.targetEmployeeId)) {
      return createErrorResult(
        createDomainError(
          "MISSING_TARGET_EMPLOYEE",
          "To generate a document, please open 'Ask AI' directly from the specific employee's profile page.",
          400
        )
      );
    }

    const documentTypeResolution = resolveDocumentTypeFromMessages(messages, aiContext);

    if (documentTypeResolution.unsupported) {
      return createErrorResult(
        createDomainError(
          "UNSUPPORTED_DOCUMENT_TYPE",
          `I can only generate ${SUPPORTED_DOCUMENT_TYPES.map((type) => type.label).join(", ")} drafts right now.`,
          400,
        ),
      );
    }

    if (documentTypeResolution.missing) {
      return createMissingFieldsResult(
        "I can generate a document draft, but I need the document type first.",
        [missingFieldFor("document_type")],
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
      return createErrorResult(
        createDomainError(
          "TEMPLATE_DOCUMENT_TYPE_MISMATCH",
          "The active template does not match the requested document type.",
          502,
        ),
      );
    }

    const placeholderSpecs = parseTemplatePlaceholders(
      template.content_template,
    );
    const inputPlaceholders = placeholderSpecs
      .filter((placeholder) => placeholder.kind === "input")
      .map((placeholder) => placeholder.name);
    const aiGeneratedPlaceholders = placeholderSpecs.filter(
      (placeholder) => placeholder.kind === "ai_generated",
    );
    const placeholders = placeholderSpecs.map(
      (placeholder) => placeholder.name,
    );
    const requiredFields = requiredFieldsForTemplate(inputPlaceholders);

    logger.info(
      `[DocumentGeneration] conversationId=${aiContext.conversationId || "none"}`,
    );
    logger.info(
      `[DocumentGeneration] requiredFields=${JSON.stringify(requiredFields)}`,
    );

    const collectedUserValues = collectValuesFromMessages(
      messages,
      requiredFields,
      { baseDate },
    );
    const userValues = selectUserSuppliedFields(
      collectedUserValues,
      requiredFields,
    );
    logger.info(
      `[DocumentGeneration] previouslyCollectedFields=${JSON.stringify(Object.keys(userValues))}`,
    );

    const rawFieldValues =
      aiContext.field_values && typeof aiContext.field_values === "object"
        ? aiContext.field_values
        : {};
    const structuredFieldValues = selectUserSuppliedFields(
      rawFieldValues,
      requiredFields,
    );
    logger.info(
      `[DocumentGeneration] newlyExtractedFieldValues=${JSON.stringify(Object.keys(structuredFieldValues))}`,
    );

    const company = await getCompanyContextAndValues({
      requiredFields,
      aiGeneratedPlaceholders,
      aiContext,
      getCompanyContextFn,
    });

    const employee = await getEmployeeContextAndValues({
      requiredFields,
      aiContext,
      getEmployeeContextFn,
    });

    const values = {
      ...(hasValue(aiContext.targetEmployeeId) ? { employee_id: aiContext.targetEmployeeId } : {}),
      ...company.values,
      ...employee.values,
      ...userValues,
      ...structuredFieldValues,
    };

    if (hasValue(aiContext.targetEmployeeId)) {
      values.employee_id = aiContext.targetEmployeeId;
    }

    // Strict company fields must always take precedence over user input
    for (const field of STRICT_COMPANY_FIELDS) {
      if (hasValue(company.values[field])) {
        values[field] = company.values[field];
      }
    }
    logger.info(
      `[DocumentGeneration] mergedFields=${JSON.stringify(Object.keys(values))}`,
    );

    const missingFields = buildMissingFields(requiredFields, values);
    logger.info(
      `[DocumentGeneration] missingFields=${JSON.stringify(missingFields.map((field) => field.field_name))}`,
    );
    if (missingFields.length > 0) {
      return createMissingFieldsResult(
        "I can create that draft, but I need a few required fields first.",
        missingFields,
      );
    }

    const clauseGeneration = await generateAiClauseValues({
      aiGeneratedPlaceholders,
      documentType,
      values,
      companyContext: company.context,
      aiContext,
      retrieveKnowledgeFn,
      generateLegalClauseFn,
    });

    const finalValues = {
      ...values,
      ...clauseGeneration.values,
    };
    logger.info(
      `[DocumentGeneration] finalGenerationPayloadFields=${JSON.stringify(Object.keys(finalValues))}`,
    );

    const contentHtml = renderTemplate(template.content_template, finalValues);
    const title = buildDocumentTitle(documentType, finalValues);

    let saveResponse;
    try {
      saveResponse = await saveDocumentFn(
        aiContext,
        buildDocumentSavePayload({
          template,
          title,
          contentHtml,
          finalValues,
          placeholders,
          placeholderSpecs,
          generatedClauses: clauseGeneration.generatedClauses,
          targetEmployeeId: aiContext.targetEmployeeId,
        }),
      );
    } catch (error) {
      return createErrorResult(createSaveError(error));
    }

    const resultCard = buildDocumentDraftResultCard({
      saveResponse,
      finalValues,
      targetEmployeeId: aiContext.targetEmployeeId,
    });

    return {
      success: true,
      status: "saved",
      message: `I've created and saved ${title} as a draft.`,
      sources: clauseGeneration.sources,
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
