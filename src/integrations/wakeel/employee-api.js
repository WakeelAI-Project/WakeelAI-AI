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
  const fetchContext = { ...aiContext };
  if (aiContext.role === 'HR_Manager' && aiContext.targetEmployeeId) {
    fetchContext.userId = aiContext.targetEmployeeId;
  }
  return wakeelFetch("GET", "/api/ai/employee-context", fetchContext);
};

/**
 * FIX-17: resolves an employee typed by name (e.g. "generate a contract for Ahmed
 * Hassan" asked from the general Assistant page, where no employee is targeted yet)
 * instead of failing outright. HR_Manager-only, company-scoped, capped server-side.
 *
 * Target .NET Contract:
 * GET /api/ai/employees/search?name={name}
 *
 * @param {import("../../contracts/index.js").AIContext} aiContext Trusted AI context
 * @param {string} name Free-text name to search for
 * @returns {Promise<{employees: Array<{employee_id: string, full_name: string}>}>}
 */
export const searchEmployeesByNameApi = async (aiContext, name) => {
  return wakeelFetch("GET", `/api/ai/employees/search?name=${encodeURIComponent(name)}`, aiContext);
};
