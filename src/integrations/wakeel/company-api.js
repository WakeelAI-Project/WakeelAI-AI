import { wakeelFetch } from "./wakeel-client.js";
import { logger } from "../../shared/logger.js";

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
  logger.info("[CompanyAPI] >>> ENTERED getCompanyContextApi <<<");
  logger.info("[CompanyAPI] endpoint = /api/ai/company-context");
  logger.info(`[CompanyAPI] companyId present = ${Boolean(aiContext?.companyId)}`);
  return wakeelFetch("GET", "/api/ai/company-context", aiContext);
};
