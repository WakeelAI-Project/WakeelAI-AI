import { z } from "zod";
import { logger } from "../shared/logger.js";
import { getEmployeeContextApi } from "../integrations/wakeel/employee-api.js";

// Zod schema for Employee Context validation
const EmployeeContextSchema = z.object({
  employeeId: z.string().min(1, "employeeId is required"),
  fullName: z.string().min(1, "fullName is required"),
  department: z.string().optional().nullable(),
  jobTitle: z.string().optional().nullable(),
  employmentStatus: z.string().optional().nullable(),
  leaveBalance: z.object({
    annual: z.number().default(0),
    casual: z.number().default(0),
    sick: z.number().default(0),
  }).optional().nullable()
});

/**
 * Retrieves and validates the employee context for the authenticated user.
 * 
 * @param {import("../contracts/index.js").AIContext} aiContext 
 * @returns {Promise<Object>}
 */
export const getEmployeeContext = async (aiContext) => {
  if (!aiContext || !aiContext.userId || !aiContext.companyId) {
    logger.warn("[EmployeeContextService] Missing required AI Context (userId or companyId)");
    throw new Error("Missing required AI Context for employee context retrieval.");
  }

  try {
    logger.info(`[EmployeeContextService] Fetching employee context for userId=${aiContext.userId}`);
    const rawContext = await getEmployeeContextApi(aiContext);
    
    // Validate response
    const parsed = EmployeeContextSchema.safeParse(rawContext);
    if (!parsed.success) {
      logger.error("[EmployeeContextService] Invalid response from .NET backend:", parsed.error.format());
      throw new Error("Invalid employee context received from backend.");
    }
    
    return parsed.data;
  } catch (error) {
    logger.error(`[EmployeeContextService] Failed to retrieve employee context: ${error.message}`);
    // Rethrow to be handled by the orchestrator/skill gracefully
    throw error;
  }
};
