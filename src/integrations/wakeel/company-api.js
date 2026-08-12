import { wakeelFetch } from "./wakeel-client.js";

/**
 * Retrieves the company context for the authenticated user from the .NET Backend.
 * 
 * Target .NET Contract:
 * GET /api/ai/company-context
 * 
 * @param {import("../../contracts/index.js").AIContext} aiContext Trusted AI context
 * @returns {Promise<Object>}
 */
export const getCompanyContextApi = async (aiContext) => {
  return wakeelFetch("GET", "/api/ai/company-context", aiContext);
};
