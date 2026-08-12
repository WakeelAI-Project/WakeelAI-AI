import { wakeelFetch } from "./wakeel-client.js";

/**
 * Retrieves the employee context for the authenticated user from the .NET Backend.
 * 
 * Target .NET Contract:
 * GET /api/ai/employee-context
 * 
 * @param {import("../../contracts/index.js").AIContext} aiContext Trusted AI context
 * @returns {Promise<Object>}
 */
export const getEmployeeContextApi = async (aiContext) => {
  return wakeelFetch("GET", "/api/ai/employee-context", aiContext);
};
