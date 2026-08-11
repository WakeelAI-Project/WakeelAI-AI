import { z } from "zod";
import { logger } from "../shared/logger.js";
import { getCompanyContextApi } from "../integrations/wakeel/company-api.js";

// Zod schema for Company Context validation
const CompanyContextSchema = z.object({
  id: z.string().min(1, "id is required"),
  name: z.string().min(1, "name is required"),
  tax_id: z.string().optional().nullable(),
  industry: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  phone_number: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  logo_url: z.string().optional().nullable(),
  working_hours: z.string().optional().nullable(),
  registered_at: z.string().optional().nullable(),
});

/**
 * Retrieves and validates the company context for the authenticated user.
 * 
 * @param {import("../contracts/index.js").AIContext} aiContext 
 * @returns {Promise<Object>}
 */
export const getCompanyContext = async (aiContext) => {
  if (!aiContext || !aiContext.companyId) {
    logger.warn("[CompanyContextService] Missing required AI Context (companyId)");
    throw new Error("Missing required AI Context for company context retrieval.");
  }

  try {
    logger.info(`[CompanyContextService] Fetching company context for companyId=${aiContext.companyId}`);
    const rawContext = await getCompanyContextApi(aiContext);
    
    // Validate response
    const parsed = CompanyContextSchema.safeParse(rawContext);
    if (!parsed.success) {
      logger.error("[CompanyContextService] Invalid response from .NET backend:", parsed.error.format());
      throw new Error("Invalid company context received from backend.");
    }
    
    return parsed.data;
  } catch (error) {
    logger.error(`[CompanyContextService] Failed to retrieve company context: ${error.message}`);
    // Rethrow to be handled by the orchestrator/skill gracefully
    throw error;
  }
};
