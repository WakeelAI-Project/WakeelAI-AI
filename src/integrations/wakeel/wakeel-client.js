import { config } from "../../config/env.js";
import { logger } from "../../shared/logger.js";

/**
 * Executes an internal service-to-service HTTP request to the Wakeel .NET Backend.
 * 
 * @param {string} method HTTP method (GET, POST, etc.)
 * @param {string} endpoint Endpoint path (e.g., '/api/ai/context/employee')
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
    // Outbound authentication for AI Server -> .NET Backend
    "X-Wakeel-Internal-Key": config.WAKEEL_INTERNAL_API_KEY,
    // Trusted identity context
    "X-Wakeel-User-Id": aiContext.userId,
    "X-Wakeel-Company-Id": aiContext.companyId,
    "X-Wakeel-Role": aiContext.role,
  };

  const options = {
    method,
    headers,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);

    if (!response.ok) {
      if (response.status === 404) {
        const error = new Error(`Resource not found at ${endpoint}`);
        error.code = "NOT_FOUND";
        error.status = 404;
        throw error;
      }
      
      if (response.status === 401 || response.status === 403) {
        const error = new Error(`Authentication/Authorization failed for ${endpoint}`);
        error.code = "UNAUTHORIZED_BACKEND";
        error.status = response.status;
        throw error;
      }

      const errorText = await response.text().catch(() => "");
      const error = new Error(`Backend error ${response.status} from ${endpoint}`);
      error.code = "BACKEND_ERROR";
      error.status = response.status;
      error.details = errorText;
      throw error;
    }

    return await response.json();
  } catch (err) {
    logger.error(`[WakeelClient] Request failed: ${method} ${endpoint} - ${err.message}`);
    throw err;
  }
};
