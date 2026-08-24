import { z } from "zod";
import { logger } from "../shared/logger.js";
import { getEmployeeContextApi } from "../integrations/wakeel/employee-api.js";

// Zod schemas for Leave Balances and Employee Context validation
const LeaveBalanceItemSchema = z.object({
  total_days: z.number().nullable().optional(),
  used_days: z.number().nullable().optional().default(0),
  remaining_days: z.number().nullable().optional(),
  is_uncapped: z.boolean().nullable().optional(),
}).nullable().optional();

const EmployeeLeaveBalancesSchema = z.object({
  annual: LeaveBalanceItemSchema,
  sick: LeaveBalanceItemSchema,
  unpaid: LeaveBalanceItemSchema,
}).nullable().optional();

// Zod schema for Employee Context validation
const EmployeeContextSchema = z.object({
  record_id: z.string().min(1, "record_id is required"),
  company_id: z.string().optional().nullable(),
  role: z.string().optional().nullable(),
  full_name: z.string().min(1, "full_name is required"),
  department: z.string().optional().nullable(),
  job_title: z.string().optional().nullable(),
  employment_status: z.string().optional().nullable(),
  salary: z.number().optional().nullable(),
  hire_date: z.string().optional().nullable(),
  leave_balance: EmployeeLeaveBalancesSchema,
}).passthrough();

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
