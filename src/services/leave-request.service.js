import { ACTION_TYPES, MissingFieldSchema, ResultCardSchema } from "../contracts/index.js";
import { getEmployeeContext } from "./employee-context.service.js";
import {
  createLeaveDraft,
  submitLeaveDraft,
  cancelLeaveDraft,
  getLatestLeaveDraft,
} from "../integrations/wakeel/leave-api.js";
import { LEAVE_TYPES, normalizeLeaveType } from "../domain/leave-types.js";
import { logger } from "../shared/logger.js";

const REQUIRED_CREATE_FIELDS = Object.freeze(["leave_type", "start_date", "end_date"]);

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

const missingFieldFor = (fieldName) => {
  const fields = {
    leave_type: {
      field_name: "leave_type",
      input_type: "dropdown",
      label: "Leave Type",
      options: [...LEAVE_TYPES],
      required: true,
    },
    start_date: {
      field_name: "start_date",
      input_type: "date",
      label: "Start Date",
      options: [],
      required: true,
    },
    end_date: {
      field_name: "end_date",
      input_type: "date",
      label: "End Date",
      options: [],
      required: true,
    },
    reason: {
      field_name: "reason",
      input_type: "text",
      label: "Reason / description",
      options: [],
      required: false,
    },
  };

  return MissingFieldSchema.parse(fields[fieldName]);
};

const appendOptionalReasonField = (missingFields, values) => (
  hasValue(values.reason)
    ? missingFields
    : [...missingFields, missingFieldFor("reason")]
);

const buildMissingFields = (values) => {
  const missingFields = REQUIRED_CREATE_FIELDS
    .filter((fieldName) => !hasValue(values[fieldName]))
    .map(missingFieldFor);

  return missingFields.length > 0
    ? appendOptionalReasonField(missingFields, values)
    : missingFields;
};

const normalizeLeaveDraftArgs = (args = {}) => {
  const normalized = normalizeLeaveType(args.leave_type);
  return {
    ...args,
    leave_type: normalized || args.leave_type,
  };
};

const mapBackendError = (error) => {
  // Extract backend error code - prioritize backendError field from WakeelClient
  const code = error?.backendError || error?.code || error?.details?.error || "LEAVE_REQUEST_FAILED";
  const status = error?.status || 500;
  const backendMessage = error?.backendMessage;

  // Map known backend error codes to user-friendly messages
  const errorMessages = {
    // Validation errors (400)
    validation_error: "The leave dates or leave request details are invalid.",
    
    // Authorization errors (403)
    forbidden: "You are not authorized to perform this action.",
    
    // Not found errors (404)
    leave_request_not_found: "I could not find that leave request for your account.",
    
    // Business rule conflicts (409)
    overlapping_leave_request: "You already have a leave request that overlaps with these dates.",
    not_a_draft: "That leave request has already been submitted or is no longer a draft.",
    not_pending: "That leave request is not pending HR review.",
    
    // Business validation errors (422)
    insufficient_leave_balance: "You do not have enough leave balance for this request.",
    attachment_required: "Sick leave requires a medical report attachment. The current chat flow cannot upload that attachment, so I cannot create the request yet.",
    invalid_attachment: "The attachment URL is invalid or does not belong to your company.",
    
    // System/AI errors
    LEAVE_AUTH_TOKEN_UNAVAILABLE: "The AI Server cannot create leave requests end-to-end yet because the employee JWT is not available in the AI context.",
  };

  // Use mapped message if available, otherwise use backend message, otherwise generic
  const message = errorMessages[code] || backendMessage || "I could not complete the leave request.";

  return createDomainError(code, message, status, error?.details);
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

export async function handleCreateLeaveDraft(aiContext, args, dependencies = {}) {
  const { createLeaveDraftFn = createLeaveDraft, baseDate = new Date() } = dependencies;

  try {
    const values = normalizeLeaveDraftArgs(args);

    if (hasValue(values.leave_type) && !LEAVE_TYPES.includes(values.leave_type)) {
      return createErrorResult(createDomainError(
        "LEAVE_TYPE_INVALID",
        "The leave type must be Annual, Sick, or Unpaid.",
        400
      ));
    }

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

    if (values.leave_type === "Sick") {
      if (!hasValue(values.attachment_url)) {
        const missingAttachmentField = MissingFieldSchema.parse({
          field_name: "attachment_url",
          input_type: "file",
          label: "Medical Report",
          options: [],
          required: true,
        });
        return createMissingFieldsResult(
          appendOptionalReasonField([...missingFields, missingAttachmentField], values)
        );
      }
    }

    let createResponse;
    try {
      createResponse = await createLeaveDraftFn(aiContext, {
        leave_type: values.leave_type,
        start_date: values.start_date,
        end_date: values.end_date,
        reason: hasValue(values.reason) ? values.reason : undefined,
        attachment_url: hasValue(values.attachment_url) ? values.attachment_url : undefined,
      });
    } catch (error) {
      return createErrorResult(mapBackendError(error));
    }

    const resultCard = buildLeaveResultCard({
      values,
      createResponse,
      attachmentUploaded: false,
    });

    return {
      success: true,
      status: "draft_created",
      message: `I've created your ${values.leave_type.toLowerCase()} leave draft.`,
      sources: [],
      action: {
        type: "leave_request",
        payload: {
          request_id: createResponse.request_id,
          status: createResponse.status,
        },
      },
      result_card: resultCard,
      leave_request: {
        request_id: createResponse.request_id,
        status: createResponse.status,
      },
      employee_context_used: true,
    };
  } catch (error) {
    logger.error(`[LeaveRequestService] Failed to create leave draft: ${error.message}`);
    return createErrorResult(error.code ? error : createDomainError(
      "LEAVE_REQUEST_FAILED",
      "I could not complete the leave request.",
      500
    ));
  }
}

/**
 * Human-readable summary of a draft, used in confirmation / disambiguation text.
 * Falls back gracefully when the backend only gave us a request_id.
 */
const describeDraft = (details) => {
  const leaveType = hasValue(details?.leave_type)
    ? `${String(details.leave_type).toLowerCase()} leave`
    : "leave";

  return hasValue(details?.start_date) && hasValue(details?.end_date)
    ? `your ${leaveType} request from ${details.start_date} to ${details.end_date}`
    : `your ${leaveType} request`;
};

const toActionPayload = (requestId, details) => ({
  request_id: requestId,
  leave_type: details?.leave_type ?? null,
  start_date: details?.start_date ?? null,
  end_date: details?.end_date ?? null,
  days_requested: details?.days_requested ?? null,
});

const createSubmitConfirmationResult = (requestId, details) => ({
  success: true,
  status: "needs_confirmation",
  message:
    `Just to confirm — should I submit ${describeDraft(details)} to HR? `
    + "Once it is submitted you cannot undo it yourself. Reply \"yes\" to confirm.",
  sources: [],
  action: {
    type: ACTION_TYPES.LEAVE_SUBMIT_CONFIRMATION,
    payload: toActionPayload(requestId, details),
  },
});

const createDisambiguationResult = (candidates, operation) => {
  const verb = operation === "cancel_leave_draft" ? "cancel" : "submit";
  const list = candidates
    .map((draft, index) => `${index + 1}. ${describeDraft(draft)}`)
    .join("\n");

  return {
    success: true,
    status: "needs_disambiguation",
    message: `You have more than one open leave draft. Which one should I ${verb}?\n${list}`,
    sources: [],
    action: {
      type: ACTION_TYPES.LEAVE_DRAFT_SELECTION,
      payload: {
        operation,
        drafts: candidates.map((draft) => toActionPayload(draft.request_id, draft)),
      },
    },
  };
};

const createNoDraftFoundResult = (operation) => ({
  success: true,
  status: "no_draft_found",
  message:
    operation === "cancel_leave_draft"
      ? "I couldn't find a leave draft to cancel. Would you like me to create one?"
      : "I couldn't find a leave draft to submit. Would you like me to create one?",
  sources: [],
  action: null,
});

/**
 * Last-resort resolution of the draft the user means, via the backend.
 * A missing endpoint / 404 / transient failure all mean "no draft found" here —
 * never a technical error surfaced to the employee.
 */
const resolveDraftFromBackend = async (aiContext, getLatestLeaveDraftFn) => {
  try {
    return await getLatestLeaveDraftFn(aiContext);
  } catch (error) {
    logger.warn(
      `[LeaveRequestService] Latest-draft lookup unavailable: ${error.message}`
    );
    return null;
  }
};

export async function handleSubmitLeaveDraft(aiContext, args, dependencies = {}) {
  const {
    submitLeaveDraftFn = submitLeaveDraft,
    getLatestLeaveDraftFn = getLatestLeaveDraft,
  } = dependencies;

  const candidates = Array.isArray(args.leave_draft_candidates)
    ? args.leave_draft_candidates
    : [];

  if (!args.request_id && candidates.length > 1) {
    return createDisambiguationResult(candidates, "submit_leave_draft");
  }

  let requestId = args.request_id;
  let details = args.leave_draft_details || null;

  if (!requestId) {
    const latest = await resolveDraftFromBackend(aiContext, getLatestLeaveDraftFn);
    if (latest) {
      requestId = latest.request_id;
      details = latest;
    }
  }

  if (!requestId) {
    return createNoDraftFoundResult("submit_leave_draft");
  }

  // Submitting is not reversible by the employee, so never do it implicitly.
  if (!args.leave_draft_confirmed) {
    return createSubmitConfirmationResult(requestId, details);
  }

  try {
    const submitResponse = await submitLeaveDraftFn(aiContext, requestId);
    return {
      success: true,
      status: "submitted",
      message: `I've submitted your leave request. It is pending HR approval.`,
      sources: [],
      action: {
        type: "leave_request",
        payload: {
          request_id: submitResponse.request_id,
          status: submitResponse.status,
        },
      },
      leave_request: {
        request_id: submitResponse.request_id,
        status: submitResponse.status,
      },
    };
  } catch (error) {
    logger.error(`[LeaveRequestService] Failed to submit leave draft: ${error.message}`);
    return createErrorResult(mapBackendError(error));
  }
}

export async function handleCancelLeaveDraft(aiContext, args, dependencies = {}) {
  const {
    cancelLeaveDraftFn = cancelLeaveDraft,
    getLatestLeaveDraftFn = getLatestLeaveDraft,
  } = dependencies;

  const candidates = Array.isArray(args.leave_draft_candidates)
    ? args.leave_draft_candidates
    : [];

  if (!args.request_id && candidates.length > 1) {
    return createDisambiguationResult(candidates, "cancel_leave_draft");
  }

  let requestId = args.request_id;

  if (!requestId) {
    const latest = await resolveDraftFromBackend(aiContext, getLatestLeaveDraftFn);
    if (latest) {
      requestId = latest.request_id;
    }
  }

  if (!requestId) {
    return createNoDraftFoundResult("cancel_leave_draft");
  }

  try {
    const cancelled = await cancelLeaveDraftFn(aiContext, requestId);
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
  } catch (error) {
    logger.error(`[LeaveRequestService] Failed to cancel leave draft: ${error.message}`);
    return createErrorResult(mapBackendError(error));
  }
}
