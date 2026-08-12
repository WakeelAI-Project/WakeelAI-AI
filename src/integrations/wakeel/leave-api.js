import { z } from "zod";
import { config } from "../../config/env.js";

const LeaveCreateRequestSchema = z.object({
  leave_type: z.enum(["Annual", "Sick", "Unpaid"]),
  start_date: z.string().trim().min(1, "start_date is required"),
  end_date: z.string().trim().min(1, "end_date is required"),
  reason: z.string().trim().max(500).optional(),
  attachment: z.unknown().optional(),
}).strict();

const LeaveCreateResponseSchema = z.object({
  request_id: z.string().trim().min(1),
  status: z.literal("Draft"),
  days_requested: z.number().int().positive(),
}).strict();

const LeaveSubmitResponseSchema = z.object({
  request_id: z.string().trim().min(1),
  status: z.literal("Pending"),
}).strict();

const createLeaveApiError = ({ code, message, status, details }) => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
};

const getEmployeeJwt = (aiContext) => {
  const token = aiContext?.employeeJwt;

  if (!token || typeof token !== "string" || token.trim().length === 0) {
    throw createLeaveApiError({
      code: "LEAVE_AUTH_TOKEN_UNAVAILABLE",
      status: 501,
      message: "The AI Server does not currently have the employee JWT required by the leave-request backend endpoints.",
    });
  }

  return token.trim();
};

const appendIfPresent = (form, fieldName, value) => {
  if (value !== undefined && value !== null && String(value).trim().length > 0) {
    form.append(fieldName, value);
  }
};

const buildCreateForm = (payload) => {
  const form = new FormData();
  form.append("leave_type", payload.leave_type);
  form.append("start_date", payload.start_date);
  form.append("end_date", payload.end_date);
  appendIfPresent(form, "reason", payload.reason);

  if (payload.attachment) {
    form.append("attachment", payload.attachment);
  }

  return form;
};

const readErrorBody = async (response) => {
  const text = await response.text().catch(() => "");
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
};

const parseJsonResponse = async (response, endpoint, schema) => {
  if (!response.ok) {
    const details = await readErrorBody(response);
    throw createLeaveApiError({
      code: details?.error || "LEAVE_BACKEND_ERROR",
      status: response.status,
      message: details?.message || `Backend error ${response.status} from ${endpoint}`,
      details,
    });
  }

  const data = await response.json();
  const parsed = schema.safeParse(data);

  if (!parsed.success) {
    throw createLeaveApiError({
      code: "LEAVE_BACKEND_RESPONSE_INVALID",
      status: 502,
      message: `Invalid leave backend response from ${endpoint}.`,
      details: parsed.error.message,
    });
  }

  return parsed.data;
};

/**
 * Creates a leave draft through the actual .NET leave API.
 *
 * The actual backend requires Authorization: Bearer <employee JWT>. The
 * current AI chat gateway does not populate this value, so this integration
 * intentionally fails closed until the real token is available in aiContext.
 *
 * @param {import("../../contracts/index.js").AIContext & { employeeJwt?: string }} aiContext
 * @param {z.infer<typeof LeaveCreateRequestSchema>} payload
 * @param {Object} [dependencies]
 * @returns {Promise<z.infer<typeof LeaveCreateResponseSchema>>}
 */
export async function createLeaveDraft(aiContext, payload, dependencies = {}) {
  const parsedPayload = LeaveCreateRequestSchema.safeParse(payload);
  if (!parsedPayload.success) {
    throw createLeaveApiError({
      code: "LEAVE_CREATE_PAYLOAD_INVALID",
      status: 400,
      message: "Invalid leave create payload.",
      details: parsedPayload.error.message,
    });
  }

  const {
    fetchFn = fetch,
    baseUrl = config.WAKEEL_API_BASE_URL,
  } = dependencies;

  const employeeJwt = getEmployeeJwt(aiContext);
  const endpoint = "/api/leave-requests";
  const response = await fetchFn(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${employeeJwt}`,
    },
    body: buildCreateForm(parsedPayload.data),
  });

  return parseJsonResponse(response, endpoint, LeaveCreateResponseSchema);
}

/**
 * Submits a leave draft so the backend changes it to Pending.
 *
 * @param {import("../../contracts/index.js").AIContext & { employeeJwt?: string }} aiContext
 * @param {string} requestId
 * @param {Object} [dependencies]
 * @returns {Promise<z.infer<typeof LeaveSubmitResponseSchema>>}
 */
export async function submitLeaveDraft(aiContext, requestId, dependencies = {}) {
  if (!requestId || String(requestId).trim().length === 0) {
    throw createLeaveApiError({
      code: "LEAVE_REQUEST_ID_REQUIRED",
      status: 400,
      message: "request_id is required to submit a leave draft.",
    });
  }

  const {
    fetchFn = fetch,
    baseUrl = config.WAKEEL_API_BASE_URL,
  } = dependencies;

  const employeeJwt = getEmployeeJwt(aiContext);
  const endpoint = `/api/leave-requests/${requestId}/submit`;
  const response = await fetchFn(`${baseUrl}${endpoint}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${employeeJwt}`,
    },
  });

  return parseJsonResponse(response, endpoint, LeaveSubmitResponseSchema);
}

/**
 * Cancels a leave draft through the actual backend draft-cancel endpoint.
 *
 * @param {import("../../contracts/index.js").AIContext & { employeeJwt?: string }} aiContext
 * @param {string} requestId
 * @param {Object} [dependencies]
 * @returns {Promise<{request_id: string, status: "Cancelled"}>}
 */
export async function cancelLeaveDraft(aiContext, requestId, dependencies = {}) {
  if (!requestId || String(requestId).trim().length === 0) {
    throw createLeaveApiError({
      code: "LEAVE_REQUEST_ID_REQUIRED",
      status: 400,
      message: "request_id is required to cancel a leave draft.",
    });
  }

  const {
    fetchFn = fetch,
    baseUrl = config.WAKEEL_API_BASE_URL,
  } = dependencies;

  const employeeJwt = getEmployeeJwt(aiContext);
  const endpoint = `/api/leave-requests/${requestId}`;
  const response = await fetchFn(`${baseUrl}${endpoint}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${employeeJwt}`,
    },
  });

  if (!response.ok) {
    const details = await readErrorBody(response);
    throw createLeaveApiError({
      code: details?.error || "LEAVE_BACKEND_ERROR",
      status: response.status,
      message: details?.message || `Backend error ${response.status} from ${endpoint}`,
      details,
    });
  }

  return {
    request_id: requestId,
    status: "Cancelled",
  };
}

