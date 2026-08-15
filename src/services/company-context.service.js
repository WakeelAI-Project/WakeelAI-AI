import { z } from "zod";
import { logger } from "../shared/logger.js";
import { getCompanyContextApi } from "../integrations/wakeel/company-api.js";

// Zod schema for Company Context validation.
// Field names match the .NET CompanyContextResponse [JsonPropertyName] attributes.
// registered_at arrives as an ISO-8601 string (System.Text.Json serializes DateTime as string).
// policy_available is included because .NET returns it and the LLM uses it to advise
// whether company-policy RAG is available.
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
  policy_available: z.boolean().optional().nullable(),
});

/**
 * Retrieves and validates the company context for the authenticated user.
 * 
 * @param {import("../contracts/index.js").AIContext} aiContext 
 * @returns {Promise<Object>}
 */
export const getCompanyContext = async (aiContext) => {
  logger.info("[CompanyContextService] >>> ENTERED getCompanyContext <<<");
  logger.info(`[CompanyContextService] companyId present = ${Boolean(aiContext?.companyId)}`);

  if (!aiContext || !aiContext.companyId) {
    logger.warn("[CompanyContextService] Missing required AI Context (companyId)");
    throw new Error("Missing required AI Context for company context retrieval.");
  }

  try {
    logger.info(`[CompanyContextService] Fetching company context for companyId=${aiContext.companyId}`);
    logger.info("[CompanyContextService] >>> CALLING getCompanyContextApi <<<");
    const rawContext = await getCompanyContextApi(aiContext);
    logger.info("[CompanyContextService] >>> API RETURNED <<<");
    
    logger.info(
      `[CompanyContextService] Received company context response. ` +
      `Fields present: [${Object.keys(rawContext || {}).join(", ")}]`
    );

    // Validate response
    const parsed = CompanyContextSchema.safeParse(rawContext);
    if (!parsed.success) {
      logger.error(
        "[CompanyContextService] Invalid response shape from .NET backend. " +
        "Validation errors: " + JSON.stringify(parsed.error.format())
      );
      throw new Error("Invalid company context received from backend.");
    }
    logger.info("[CompanyContextService] >>> VALIDATION PASSED <<<");
    logger.info(`[CompanyContextService] companyName present = ${Boolean(parsed.data.name)}`);
    
    // Return a normalized context object with human-readable labels.
    // The orchestrator injects this into the final LLM prompt as JSON;
    // explicit field names help the LLM match company attributes to user questions.
    const normalizedContext = {
      companyId: parsed.data.id,
      companyName: parsed.data.name,
      industry: parsed.data.industry ?? null,
      workingHours: parsed.data.working_hours ?? null,
      address: parsed.data.address ?? null,
      phoneNumber: parsed.data.phone_number ?? null,
      email: parsed.data.email ?? null,
      registeredAt: parsed.data.registered_at ?? null,
      policyAvailable: parsed.data.policy_available ?? false,
    };

    logger.info("[CompanyContextService] >>> RETURNING COMPANY CONTEXT <<<");
    return normalizedContext;
  } catch (error) {
    logger.error(`[CompanyContextService] Failed to retrieve company context: ${error.message}`);
    // Rethrow to be handled by the orchestrator/skill gracefully
    throw error;
  }
};
