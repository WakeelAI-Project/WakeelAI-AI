import { MissingFieldSchema, ResultCardSchema } from "../contracts/index.js";
import { getEmployeeContext } from "./employee-context.service.js";
import { createLeaveDraft, submitLeaveDraft, cancelLeaveDraft } from "../integrations/wakeel/leave-api.js";
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

const normalizeLeaveDraftArgs = (args = {}) => ({
  ...args,
  leave_type: normalizeLeaveType(args.leave_type) || args.leave_type,
});

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

export async function handleCreateLeaveDraft(aiContext, args, dependencies = {}) {
  const { createLeaveDraftFn = createLeaveDraft, baseDate = new Date() } = dependencies;

  try {
    const values = normalizeLeaveDraftArgs(args);
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
          options: []
        });
        return createMissingFieldsResult([...missingFields, missingAttachmentField]);
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

export async function handleSubmitLeaveDraft(aiContext, args, dependencies = {}) {
  const { submitLeaveDraftFn = submitLeaveDraft } = dependencies;
  const requestId = args.request_id;

  if (!requestId) {
    return createErrorResult(createDomainError(
      "LEAVE_REQUEST_ID_REQUIRED",
      "I need a draft request ID to submit.",
      400
    ));
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
  const { cancelLeaveDraftFn = cancelLeaveDraft } = dependencies;
  const requestId = args.request_id;

  if (!requestId) {
    return createErrorResult(createDomainError(
      "LEAVE_REQUEST_ID_REQUIRED",
      "I need a draft request ID to cancel.",
      400
    ));
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
