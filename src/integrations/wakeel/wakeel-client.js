import { config } from "../../config/env.js";
import { logger } from "../../shared/logger.js";

const summarizeHeaders = (headers) => ({
  "Content-Type": headers["Content-Type"],
  "X-Internal-API-Key": headers["X-Internal-API-Key"] ? "<redacted>" : "<missing>",
  "X-User-Id": headers["X-User-Id"] ? "<present>" : "<missing>",
  "X-Company-Id": headers["X-Company-Id"] ? "<present>" : "<missing>",
  "X-Role": headers["X-Role"] || "<missing>",
});

const summarizeBody = (body) => {
  if (!body || typeof body !== "object") {
    return {
      type: body === null ? "null" : typeof body,
      fields: [],
    };
  }

  return {
    type: Array.isArray(body) ? "array" : "object",
    fields: Object.keys(body),
    hasName: Boolean(body.name || body.companyName),
    hasId: Boolean(body.id || body.companyId || body.company_id),
  };
};

const parseResponseBody = async (response) => {
  const rawText = await response.text().catch(() => "");

  if (!rawText) {
    return { rawText, parsed: null };
  }

  try {
    return { rawText, parsed: JSON.parse(rawText) };
  } catch {
    return { rawText, parsed: null };
  }
};

/**
 * Executes an internal service-to-service HTTP request to the Wakeel .NET Backend.
 *
 * @param {string} method HTTP method (GET, POST, etc.)
 * @param {string} endpoint Endpoint path (e.g., '/api/ai/employee-context')
 * @param {import("../../contracts/index.js").AIContext} aiContext Trusted AI context containing userId, companyId, role
 * @param {Object} [body] Optional JSON body
 * @returns {Promise<any>}
 */
export const wakeelFetch = async (method, endpoint, aiContext, body = null) => {
  if (!aiContext || !aiContext.userId || !aiContext.companyId || !aiContext.role) {
    throw new Error("Missing required trusted AI context for outbound request");
  }

  const url = `${config.WAKEEL_API_BASE_URL}${endpoint}`;

  const headers = {
    "Content-Type": "application/json",
    "X-Internal-API-Key": config.WAKEEL_INTERNAL_API_KEY,
    "X-User-Id": aiContext.userId,
    "X-Company-Id": aiContext.companyId,
    "X-Role": aiContext.role,
  };

  const options = {
    method,
    headers,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    logger.info(`[WakeelClient] baseURL = ${config.WAKEEL_API_BASE_URL}`);
    logger.info(`[WakeelClient] method = ${method}`);
    logger.info(`[WakeelClient] path = ${endpoint}`);
    logger.info(
      `[WakeelClient] Request: ${method} ${url}. ` +
      `Headers=${JSON.stringify(summarizeHeaders(headers))}`
    );

    const response = await fetch(url, options);
    const { rawText, parsed } = await parseResponseBody(response);

    logger.info(
      `[WakeelClient] Response: ${method} ${url} -> HTTP ${response.status}. ` +
      `Body=${JSON.stringify(summarizeBody(parsed))}`
    );
    logger.info(`[WakeelClient] response status = ${response.status}`);
    logger.info(`[WakeelClient] response fields = ${Object.keys(parsed || {}).join(",")}`);

    if (!response.ok) {
      logger.warn(
        `[WakeelClient] Non-OK response: ${method} ${endpoint} -> HTTP ${response.status}. ` +
        `companyId=${aiContext.companyId} userId=${aiContext.userId}`
      );

      if (response.status === 404) {
        const error = new Error(`Resource not found at ${endpoint}`);
        error.code = "NOT_FOUND";
        error.status = 404;
        error.responseSummary = summarizeBody(parsed);
        throw error;
      }

      if (response.status === 401 || response.status === 403) {
        const error = new Error(`Authentication/Authorization failed for ${endpoint}`);
        error.code = "UNAUTHORIZED_BACKEND";
        error.status = response.status;
        error.responseSummary = summarizeBody(parsed);
        throw error;
      }

      const error = new Error(`Backend error ${response.status} from ${endpoint}`);
      error.code = "BACKEND_ERROR";
      error.status = response.status;
      error.responseSummary = summarizeBody(parsed);
      error.details = rawText;
      throw error;
    }

    return parsed;
  } catch (err) {
    logger.error(`[WakeelClient] Request failed: ${method} ${endpoint} - ${err.message}`);
    throw err;
  }
};
