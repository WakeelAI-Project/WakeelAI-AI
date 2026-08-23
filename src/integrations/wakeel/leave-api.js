import { z } from "zod";
import { wakeelFetch } from "./wakeel-client.js";
import { LEAVE_TYPES, normalizeLeaveType } from "../../domain/leave-types.js";

/**
 * Internal M2M leave API — API v8 canonical contract.
 *
 * All three operations use wakeelFetch, which automatically attaches:
 *   X-Internal-API-Key, X-User-Id, X-Company-Id, X-Role
 *
 * These endpoints are internal AI-server endpoints, not the public employee endpoints.
 * The employee JWT (employeeJwt) is NO LONGER required or accepted here.
 *
 * Endpoints per API v8:
 *   POST   /api/ai/leave-requests                 — create a leave draft
 *   POST   /api/ai/leave-requests/:id/submit      — submit draft to Pending
 *   DELETE /api/ai/leave-requests/:id             — cancel draft
 *   GET    /api/ai/leave-requests/latest-draft    — most recent Draft (404 = none)
 */

const LeaveCreateRequestSchema = z.object({
  leave_type: z.preprocess(
    (value) => normalizeLeaveType(value) || value,
    z.enum(LEAVE_TYPES),
  ),
  start_date: z.string().trim().min(1, "start_date is required"),
  end_date: z.string().trim().min(1, "end_date is required"),
  reason: z.string().trim().max(500).optional(),
  /**
   * attachment_url: Optional URL to an already-uploaded file (e.g. a medical report
   * stored in blob storage). This replaces the old binary attachment FormData field.
   * API v8 ambiguity: .NET does not yet forward field_values (which would carry
   * attachment_url) to the AI service. When .NET is updated, this field will be
   * populated from context.field_values.attachment_url.
   */
  attachment_url: z.string().url("attachment_url must be a valid URL").optional(),
}).strict();

const LeaveCreateResponseSchema = z.object({
  request_id: z.string().trim().min(1),
  status: z.literal("Draft"),
  days_requested: z.number().int().positive(),
}).strict();

const LeaveSubmitResponseSchema = z.object({
  request_id: z.string().trim().min(1),
  status: z.literal("Pending"),
  days_requested: z.number().int().optional(),
}).passthrough();

/**
 * Lenient on purpose: only request_id is load-bearing. The rest is used to make
 * the confirmation message concrete ("your Annual leave from X to Y").
 */
const LeaveLatestDraftResponseSchema = z.object({
  request_id: z.string().trim().min(1),
  leave_type: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  days_requested: z.number().optional(),
  status: z.string().optional(),
}).passthrough();

const createLeaveApiError = ({ code, message, status, details }) => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
};

const parseJsonResponse = async (rawData, endpoint, schema) => {
  const parsed = schema.safeParse(rawData);

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
 * Creates a leave draft through the internal AI M2M endpoint.
 *
 * Uses wakeelFetch (M2M headers). No employeeJwt required.
 *
 * @param {import("../../contracts/index.js").AIContext} aiContext Trusted AI context
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

  const { fetchFn } = dependencies;
  const endpoint = "/api/ai/leave-requests";

  // wakeelFetch handles M2M headers (X-Internal-API-Key, X-User-Id, X-Company-Id, X-Role)
  // and sends JSON body — no FormData, no employeeJwt
  const data = fetchFn
    ? await fetchFn(endpoint, parsedPayload.data)
    : await wakeelFetch("POST", endpoint, aiContext, parsedPayload.data);

  return parseJsonResponse(data, endpoint, LeaveCreateResponseSchema);
}

/**
 * Submits a leave draft so the backend transitions it to Pending.
 *
 * @param {import("../../contracts/index.js").AIContext} aiContext Trusted AI context
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

  const { fetchFn } = dependencies;
  const endpoint = `/api/ai/leave-requests/${requestId}/submit`;

  const data = fetchFn
    ? await fetchFn(endpoint)
    : await wakeelFetch("PATCH", endpoint, aiContext);

  return parseJsonResponse(data, endpoint, LeaveSubmitResponseSchema);
}

/**
 * Fetches the employee's most recent Draft leave request.
 *
 * Last-resort fallback used when a typed "send it" / "cancel it" cannot be
 * resolved from conversation history. Uses wakeelFetch, so it carries the same
 * X-Internal-API-Key + X-User-Id / X-Company-Id / X-Role headers as every other
 * internal call. A 404 means "no draft found" and is NOT an error.
 *
 * @param {import("../../contracts/index.js").AIContext} aiContext Trusted AI context
 * @param {Object} [dependencies]
 * @returns {Promise<z.infer<typeof LeaveLatestDraftResponseSchema>|null>}
 */
export async function getLatestLeaveDraft(aiContext, dependencies = {}) {
  const { fetchFn } = dependencies;
  const endpoint = "/api/ai/leave-requests/latest-draft";

  let data;
  try {
    data = fetchFn
      ? await fetchFn(endpoint)
      : await wakeelFetch("GET", endpoint, aiContext);
  } catch (error) {
    if (error?.status === 404) {
      return null;
    }
    throw error;
  }

  if (!data) return null;

  const parsed = LeaveLatestDraftResponseSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/**
 * Cancels a leave draft through the internal AI M2M endpoint.
 *
 * @param {import("../../contracts/index.js").AIContext} aiContext Trusted AI context
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

  const { fetchFn } = dependencies;
  const endpoint = `/api/ai/leave-requests/${requestId}`;

  if (fetchFn) {
    await fetchFn(endpoint);
  } else {
    await wakeelFetch("DELETE", endpoint, aiContext);
  }

  return {
    request_id: requestId,
    status: "Cancelled",
  };
}
