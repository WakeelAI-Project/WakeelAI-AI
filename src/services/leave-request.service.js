import { z } from "zod";
import { MissingFieldSchema, ResultCardSchema, SourceSchema } from "../contracts/index.js";
import { getEmployeeContext } from "./employee-context.service.js";
import { getHistory } from "./chat-history.service.js";
import { retrieveKnowledge } from "../rag/retrieval/knowledge-retrieval.service.js";
import { createLeaveDraft, submitLeaveDraft, cancelLeaveDraft } from "../integrations/wakeel/leave-api.js";
import { logger } from "../shared/logger.js";

const MAX_HISTORY_MESSAGES = 50;
const LEAVE_TYPES = Object.freeze(["Annual", "Sick", "Unpaid"]);
const REQUIRED_CREATE_FIELDS = Object.freeze(["leave_type", "start_date", "end_date"]);

const MONTHS = Object.freeze({
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
});

const LeaveRequestServiceInputSchema = z.object({
  message: z.string().trim().min(1),
  aiContext: z.object({
    userId: z.string().trim().min(1),
    companyId: z.string().trim().min(1),
    role: z.string().trim().min(1),
    conversationId: z.string().trim().min(1).optional(),
  }).passthrough(),
  conversationMessages: z.array(z.object({
    role: z.string().optional(),
    content: z.string().optional(),
    missing_fields: z.array(z.object({ field_name: z.string() }).passthrough()).optional(),
    actions: z.array(z.object({
      type: z.string(),
      payload: z.record(z.string(), z.unknown()).optional(),
    }).passthrough()).optional(),
  }).passthrough()).optional(),
}).strict();

const createDomainError = (code, message, status = 400, details = undefined) => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  return error;
};

const hasValue = (value) => (
  value !== undefined
  && value !== null
  && String(value).trim().length > 0
);

const normalizeWhitespace = (value) => String(value).replace(/\s+/g, " ").trim();

const stripPunctuation = (value) => normalizeWhitespace(value)
  .replace(/^["']|["']$/g, "")
  .replace(/[.?!]+$/g, "")
  .trim();

const getYear = (baseDate) => baseDate.getUTCFullYear
  ? baseDate.getUTCFullYear()
  : new Date(baseDate).getUTCFullYear();

const normalizeIsoDate = (year, month, day) => (
  `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
);

const normalizeDateToken = (rawValue, baseDate = new Date()) => {
  const value = stripPunctuation(rawValue).replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1");

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const slashMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const [, month, day, rawYear] = slashMatch;
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
    return normalizeIsoDate(year, month, day);
  }

  const monthDayMatch = value.match(/^([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?$/);
  if (monthDayMatch) {
    const [, monthName, day, rawYear] = monthDayMatch;
    const month = MONTHS[monthName.toLowerCase()];
    if (month) {
      return normalizeIsoDate(rawYear || getYear(baseDate), month, day);
    }
  }

  const dayMonthMatch = value.match(/^(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?$/);
  if (dayMonthMatch) {
    const [, day, monthName, rawYear] = dayMonthMatch;
    const month = MONTHS[monthName.toLowerCase()];
    if (month) {
      return normalizeIsoDate(rawYear || getYear(baseDate), month, day);
    }
  }

  return null;
};

const extractDateRange = (message, baseDate = new Date()) => {
  const isoRange = message.match(/(\d{4}-\d{2}-\d{2})\s*(?:to|through|until|-|–)\s*(\d{4}-\d{2}-\d{2})/i);
  if (isoRange) {
    return {
      start_date: isoRange[1],
      end_date: isoRange[2],
    };
  }

  const monthRange = message.match(/\b([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?\s*(?:to|through|until|-|–)\s*(?:(?:([A-Za-z]+)\s+)?(\d{1,2})(?:,\s*(\d{4}))?)/i);
  if (monthRange) {
    const [, startMonthName, startDay, startYear, endMonthName, endDay, endYear] = monthRange;
    const startMonth = MONTHS[startMonthName.toLowerCase()];
    const endMonth = MONTHS[(endMonthName || startMonthName).toLowerCase()];
    const year = startYear || endYear || getYear(baseDate);

    if (startMonth && endMonth) {
      return {
        start_date: normalizeIsoDate(year, startMonth, startDay),
        end_date: normalizeIsoDate(endYear || year, endMonth, endDay),
      };
    }
  }

  return null;
};

const extractSingleDate = (message, baseDate = new Date()) => {
  const explicitDate = message.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (explicitDate) return explicitDate[1];

  const monthDate = message.match(/\b([A-Za-z]+)\s+\d{1,2}(?:,\s*\d{4})?\b/i);
  if (monthDate) return normalizeDateToken(monthDate[0], baseDate);

  const dayMonthDate = message.match(/\b\d{1,2}\s+[A-Za-z]+(?:\s+\d{4})?\b/i);
  if (dayMonthDate) return normalizeDateToken(dayMonthDate[0], baseDate);

  const slashDate = message.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/);
  if (slashDate) return normalizeDateToken(slashDate[0], baseDate);

  return null;
};

export const normalizeLeaveType = (value) => {
  const text = normalizeWhitespace(value).toLowerCase();

  if (/\bannual\b|\bvacation\b/.test(text)) return "Annual";
  if (/\bsick\b|\bmedical\b/.test(text)) return "Sick";
  if (/\bunpaid\b/.test(text)) return "Unpaid";

  return null;
};

const extractReason = (message) => {
  const reasonMatch = message.match(/\breason\s*(?:is|=|:)\s*([^.;\n]+)/i)
    || message.match(/\bdue to\s+([^.;\n]+)/i)
    || message.match(/\bbecause\s+([^.;\n]+)/i);

  if (!reasonMatch?.[1]) return null;

  const reason = stripPunctuation(reasonMatch[1]);
  return reason.length > 500 ? reason.slice(0, 500) : reason;
};

export function extractLeaveFieldsFromMessage(message, options = {}) {
  const text = message || "";
  const values = {};
  const baseDate = options.baseDate || new Date();
  const pendingFields = new Set(options.pendingFields || []);

  const leaveType = normalizeLeaveType(text);
  if (leaveType) values.leave_type = leaveType;

  const range = extractDateRange(text, baseDate);
  if (range) {
    values.start_date = range.start_date;
    values.end_date = range.end_date;
  }

  if (!values.start_date) {
    const startMatch = text.match(/\b(?:from|starting|starts|start(?:\s+date)?|on)\s+(.*)$/i);
    const singleDate = startMatch ? extractSingleDate(startMatch[1], baseDate) : null;
    if (singleDate) values.start_date = singleDate;
  }

  if (!values.end_date) {
    const endMatch = text.match(/\b(?:to|until|through|ending|ends|end(?:\s+date)?)\s+(.*)$/i);
    const singleDate = endMatch ? extractSingleDate(endMatch[1], baseDate) : null;
    if (singleDate) values.end_date = singleDate;
  }

  if (
    pendingFields.has("start_date")
    && !values.start_date
    && !pendingFields.has("end_date")
  ) {
    const singleDate = extractSingleDate(text, baseDate);
    if (singleDate) values.start_date = singleDate;
  }

  if (
    pendingFields.has("end_date")
    && !values.end_date
    && !pendingFields.has("start_date")
  ) {
    const singleDate = extractSingleDate(text, baseDate);
    if (singleDate) values.end_date = singleDate;
  }

  const reason = extractReason(text);
  if (reason) values.reason = reason;

  if (pendingFields.has("reason") && !values.reason && text.length <= 500) {
    values.reason = stripPunctuation(text);
  }

  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => hasValue(value))
  );
}

const missingFieldFor = (fieldName) => {
  const fields = {
    leave_type: {
      field_name: "leave_type",
      input_type: "dropdown",
      label: "Leave Type",
      options: [...LEAVE_TYPES],
    },
    start_date: {
      field_name: "start_date",
      input_type: "date",
      label: "Start Date",
      options: [],
    },
    end_date: {
      field_name: "end_date",
      input_type: "date",
      label: "End Date",
      options: [],
    },
  };

  return MissingFieldSchema.parse(fields[fieldName]);
};

const buildMissingFields = (values) => REQUIRED_CREATE_FIELDS
  .filter((fieldName) => !hasValue(values[fieldName]))
  .map(missingFieldFor);

const isBalanceQuestion = (message) => (
  /\b(balance|remaining|left|how many)\b/i.test(message)
  && /\b(leave|days|annual|sick|unpaid|vacation)\b/i.test(message)
);

const isQuestion = (message) => (
  /\?/.test(message)
  || /\b(?:can|could|should|would)\s+i\b/i.test(message)
  || /^\s*(?:can|could|should|would)\b/i.test(message)
);

const isCancelIntent = (message) => /\bcancel\b/i.test(message);

const isExplicitCreateIntent = (message) => {
  const text = normalizeWhitespace(message).toLowerCase();

  if (isQuestion(text)) return false;

  if (/\b(?:yes|yep|ok|okay|sure|please|go ahead)\b.*\b(?:create|submit|request|send|file|do it|it)\b/.test(text)) {
    return true;
  }

  if (/\b(?:create|submit|send|file)\s+(?:the\s+)?(?:leave\s+)?request\b/.test(text)) {
    return true;
  }

  if (/\b(?:create|submit|request)\s+it\b/.test(text)) {
    return true;
  }

  return /\b(?:request|apply for)\s+(?:an?\s+)?(?:annual|sick|unpaid)?\s*leave\b/.test(text);
};

const normalizeConversationMessages = async ({ message, aiContext, conversationMessages, getConversationHistoryFn }) => {
  if (conversationMessages) {
    const hasCurrentMessage = conversationMessages.some((candidate) => (
      candidate.role === "user" && candidate.content === message
    ));

    return hasCurrentMessage
      ? conversationMessages
      : [...conversationMessages, { role: "user", content: message }];
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

    return hasCurrentMessage ? messages : [...messages, { role: "user", content: message }];
  } catch (error) {
    logger.error(`[LeaveRequestService] Conversation history retrieval failed: ${error.message}`);
    throw createDomainError(
      "CONVERSATION_HISTORY_UNAVAILABLE",
      "I could not retrieve the conversation context needed to continue this leave request.",
      500
    );
  }
};

const collectLeaveValues = (messages, baseDate) => {
  const values = {};
  let pendingFields = [];

  for (const message of messages) {
    if (message.role === "assistant") {
      pendingFields = Array.isArray(message.missing_fields)
        ? message.missing_fields.map((field) => field.field_name)
        : [];
      continue;
    }

    if (message.role && message.role !== "user") continue;

    const extracted = extractLeaveFieldsFromMessage(message.content || "", {
      baseDate,
      pendingFields,
    });
    Object.assign(values, extracted);
    pendingFields = pendingFields.filter((fieldName) => !hasValue(extracted[fieldName]));
  }

  return values;
};

const parseIsoDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
};

const startOfUtcDay = (date) => new Date(Date.UTC(
  date.getUTCFullYear(),
  date.getUTCMonth(),
  date.getUTCDate()
));

const validateCollectedValues = (values, baseDate = new Date()) => {
  if (!LEAVE_TYPES.includes(values.leave_type)) {
    throw createDomainError(
      "LEAVE_TYPE_INVALID",
      "The leave type must be Annual, Sick, or Unpaid.",
      400
    );
  }

  const startDate = parseIsoDate(values.start_date);
  const endDate = parseIsoDate(values.end_date);

  if (!startDate || !endDate) {
    throw createDomainError(
      "LEAVE_DATES_INVALID",
      "The leave dates are invalid. Please use valid calendar dates.",
      400
    );
  }

  if (startDate < startOfUtcDay(baseDate) || endDate < startDate) {
    throw createDomainError(
      "LEAVE_DATES_INVALID",
      "The leave dates are invalid. The start date must not be in the past and the end date must be on or after the start date.",
      400
    );
  }

  if (hasValue(values.reason) && values.reason.length > 500) {
    throw createDomainError(
      "LEAVE_REASON_TOO_LONG",
      "The leave reason cannot exceed 500 characters.",
      400
    );
  }

  return {
    startDate,
    endDate,
    daysRequested: Math.floor((endDate - startDate) / 86400000) + 1,
  };
};

const balanceKeyForLeaveType = (leaveType) => leaveType.toLowerCase();

const formatBalanceLine = (label, balance) => {
  if (!balance) return `${label}: unavailable`;

  const remaining = balance.remaining_days ?? "unlimited/not capped";
  const total = balance.total_days ?? "unlimited/not capped";
  return `${label}: ${remaining} remaining out of ${total}`;
};

const buildBalanceMessage = (employeeContext, leaveType = null) => {
  const balance = employeeContext?.leave_balance || {};

  if (leaveType) {
    const key = balanceKeyForLeaveType(leaveType);
    return `Your ${leaveType.toLowerCase()} leave balance is ${formatBalanceLine(leaveType, balance[key])}.`;
  }

  return [
    "Here is your current leave balance:",
    formatBalanceLine("Annual", balance.annual),
    formatBalanceLine("Sick", balance.sick),
    formatBalanceLine("Unpaid", balance.unpaid),
  ].join("\n");
};

const buildEligibilityMessage = ({ values, validation, employeeContext, sources }) => {
  const balance = employeeContext?.leave_balance?.[balanceKeyForLeaveType(values.leave_type)];

  if ((values.leave_type === "Annual" || values.leave_type === "Sick") && balance?.remaining_days !== undefined) {
    if (balance.remaining_days < validation.daysRequested) {
      return `You do not appear to have enough ${values.leave_type.toLowerCase()} leave balance for this request. You asked for ${validation.daysRequested} day(s), and your remaining balance is ${balance.remaining_days}.`;
    }

    return `Based on your current ${values.leave_type.toLowerCase()} leave balance, you appear able to request these ${validation.daysRequested} day(s). The backend will still validate the request when it is submitted.`;
  }

  const sourceNote = sources.length > 0
    ? " I also found relevant policy/legal context, but the backend remains authoritative when creating the request."
    : "";

  return `You appear able to request these ${validation.daysRequested} ${values.leave_type.toLowerCase()} leave day(s), subject to backend validation and HR review.${sourceNote}`;
};

const shouldRetrievePolicyContext = (message) => (
  /\b(policy|company policy|labor law|law|legal|notice period|rule|eligible|eligibility)\b/i.test(message)
);

const retrievePolicyContext = async ({ message, values, aiContext, retrieveKnowledgeFn }) => {
  if (!shouldRetrievePolicyContext(message)) {
    return { sources: [] };
  }

  const sourceTypes = /\b(labor law|law|legal)\b/i.test(message)
    ? ["labor-law", "company-policy"]
    : ["company-policy"];

  const sources = [];
  const query = [
    values.leave_type,
    "leave request eligibility policy",
    values.start_date,
    values.end_date,
    message,
  ].filter(hasValue).join(" ");

  for (const sourceType of sourceTypes) {
    const result = await retrieveKnowledgeFn({
      query,
      context: {
        sourceType,
        companyId: sourceType === "company-policy" ? aiContext.companyId : undefined,
        topK: 3,
      },
    });

    const retrievedSources = Array.isArray(result?.sources) ? result.sources : [];
    sources.push(...retrievedSources.map((source) => SourceSchema.parse(source)));
  }

  return { sources };
};

const mapBackendError = (error) => {
  const code = error?.code || error?.details?.error || "LEAVE_REQUEST_FAILED";
  const status = error?.status || 500;

  const messages = {
    validation_error: "The leave dates or leave request details are invalid.",
    insufficient_leave_balance: "You do not have enough leave balance for this request.",
    attachment_required: "Sick leave requires a medical report attachment. The current chat flow cannot upload that attachment, so I cannot create the request yet.",
    leave_request_not_found: "I could not find that leave request for your account.",
    not_a_draft: "That leave request has already been submitted or is no longer a draft.",
    not_pending: "That leave request is not pending HR review.",
    LEAVE_AUTH_TOKEN_UNAVAILABLE: "The AI Server cannot create leave requests end-to-end yet because the employee JWT is not available in the AI context.",
  };

  return createDomainError(
    code,
    messages[code] || "I could not complete the leave request.",
    status,
    error?.details
  );
};

const createErrorResult = (error) => ({
  success: false,
  status: "error",
  message: error.message,
  error: {
    code: error.code || "LEAVE_REQUEST_FAILED",
    status: error.status || 500,
    details: error.details,
  },
  sources: [],
});

const createMissingFieldsResult = (missingFields) => ({
  success: true,
  status: "missing_fields",
  message: "I can help with that leave request, but I need a few required fields first.",
  missing_fields: missingFields,
  sources: [],
});

const buildLeaveResultCard = ({ values, createResponse, attachmentUploaded }) => ResultCardSchema.parse({
  type: "leave_draft",
  request_id: createResponse.request_id,
  leave_type: values.leave_type,
  start_date: values.start_date,
  end_date: values.end_date,
  days_requested: createResponse.days_requested,
  attachment_uploaded: attachmentUploaded,
  actions: [],
});

const findLatestLeaveAction = (messages) => {
  for (const message of [...messages].reverse()) {
    const actions = Array.isArray(message.actions) ? message.actions : [];
    const action = [...actions].reverse().find((candidate) => (
      candidate.type === "leave_request"
      && candidate.payload?.request_id
    ));

    if (action) return action;
  }

  return null;
};

/**
 * Handles employee-facing leave request chat behavior.
 *
 * @param {Object} input
 * @param {string} input.message
 * @param {import("../contracts/index.js").AIContext} input.aiContext
 * @param {Array<Object>} [input.conversationMessages]
 * @param {Object} [dependencies]
 * @returns {Promise<Object>}
 */
export async function handleLeaveRequest(input, dependencies = {}) {
  const parsed = LeaveRequestServiceInputSchema.safeParse(input);
  if (!parsed.success) {
    return createErrorResult(createDomainError(
      "LEAVE_REQUEST_INPUT_INVALID",
      "The leave request is missing required AI context.",
      400,
      parsed.error.message
    ));
  }

  const {
    getEmployeeContextFn = getEmployeeContext,
    getConversationHistoryFn = getHistory,
    retrieveKnowledgeFn = retrieveKnowledge,
    createLeaveDraftFn = createLeaveDraft,
    submitLeaveDraftFn = submitLeaveDraft,
    cancelLeaveDraftFn = cancelLeaveDraft,
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

    if (isCancelIntent(message)) {
      const latestLeaveAction = findLatestLeaveAction(messages);
      if (!latestLeaveAction) {
        return createErrorResult(createDomainError(
          "LEAVE_REQUEST_ID_REQUIRED",
          "I do not have a draft leave request to cancel in this conversation.",
          400
        ));
      }

      if (latestLeaveAction.payload.status && latestLeaveAction.payload.status !== "Draft") {
        return createErrorResult(createDomainError(
          "LEAVE_REQUEST_NOT_DRAFT",
          "That leave request is already pending HR review, so it cannot be cancelled through the draft-cancel endpoint.",
          409
        ));
      }

      const cancelled = await cancelLeaveDraftFn(aiContext, latestLeaveAction.payload.request_id);
      return {
        success: true,
        status: "cancelled",
        message: "I cancelled the leave draft.",
        sources: [],
        action: {
          type: "leave_request",
          payload: cancelled,
        },
        leave_request: cancelled,
      };
    }

    if (isBalanceQuestion(message) && !isExplicitCreateIntent(message)) {
      const employeeContext = await getEmployeeContextFn(aiContext);
      const leaveType = normalizeLeaveType(message);

      return {
        success: true,
        status: "info",
        message: buildBalanceMessage(employeeContext, leaveType),
        sources: [],
        employee_context_used: true,
      };
    }

    const values = collectLeaveValues(messages, baseDate);
    const missingFields = buildMissingFields(values);

    if (missingFields.length > 0) {
      return createMissingFieldsResult(missingFields);
    }

    let validation;
    try {
      validation = validateCollectedValues(values, baseDate);
    } catch (error) {
      return createErrorResult(error);
    }

    if (values.leave_type === "Sick" && isExplicitCreateIntent(message)) {
      return createErrorResult(createDomainError(
        "LEAVE_ATTACHMENT_UNSUPPORTED",
        "Sick leave requires a medical report attachment. The current chat flow cannot upload that attachment, so I cannot create the request yet.",
        422
      ));
    }

    const employeeContext = await getEmployeeContextFn(aiContext);
    const policyContext = await retrievePolicyContext({
      message,
      values,
      aiContext,
      retrieveKnowledgeFn,
    });

    if (!isExplicitCreateIntent(message)) {
      return {
        success: true,
        status: "eligibility",
        message: buildEligibilityMessage({
          values,
          validation,
          employeeContext,
          sources: policyContext.sources,
        }),
        sources: policyContext.sources,
        employee_context_used: true,
      };
    }

    let createResponse;
    try {
      createResponse = await createLeaveDraftFn(aiContext, {
        leave_type: values.leave_type,
        start_date: values.start_date,
        end_date: values.end_date,
        reason: hasValue(values.reason) ? values.reason : undefined,
      });
    } catch (error) {
      return createErrorResult(mapBackendError(error));
    }

    let submitResponse;
    try {
      submitResponse = await submitLeaveDraftFn(aiContext, createResponse.request_id);
    } catch (error) {
      const mapped = mapBackendError(error);
      return {
        ...createErrorResult(mapped),
        status: "submit_failed",
        action: {
          type: "leave_request",
          payload: {
            request_id: createResponse.request_id,
            status: createResponse.status,
          },
        },
        leave_request: {
          request_id: createResponse.request_id,
          status: createResponse.status,
        },
      };
    }

    const resultCard = buildLeaveResultCard({
      values,
      createResponse,
      attachmentUploaded: false,
    });

    return {
      success: true,
      status: "submitted",
      message: `I've submitted your ${values.leave_type.toLowerCase()} leave request. It is pending HR approval.`,
      sources: policyContext.sources,
      action: {
        type: "leave_request",
        payload: {
          request_id: submitResponse.request_id,
          status: submitResponse.status,
        },
      },
      result_card: resultCard,
      leave_request: {
        request_id: submitResponse.request_id,
        status: submitResponse.status,
        created_status: createResponse.status,
      },
      employee_context_used: true,
    };
  } catch (error) {
    logger.error(`[LeaveRequestService] Failed to handle leave request: ${error.message}`);
    return createErrorResult(error.code ? error : createDomainError(
      "LEAVE_REQUEST_FAILED",
      "I could not complete the leave request.",
      500
    ));
  }
}

