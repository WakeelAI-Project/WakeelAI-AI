import { logger } from "../shared/logger.js";

/**
 * Boundary for context gatherers (RAG, Employee, Company).
 * To be replaced or implemented by real services in future tasks.
 * 
 * @param {Array<string>} requiredContext - e.g., ["employee", "company", "rag"]
 * @param {import("../contracts/index.js").AIContext} userContext
 * @returns {Promise<Object>}
 */
export const gatherContextBoundary = async (requiredContext, userContext) => {
  const gatheredData = {};

  if (!requiredContext) return gatheredData;

  if (requiredContext.includes("employee")) {
    logger.info("[Orchestrator] Gathering employee context via boundary stub...");
    gatheredData.employee = { role: userContext.role || "unknown", status: "active stub" };
  }
  
  if (requiredContext.includes("company")) {
    logger.info("[Orchestrator] Gathering company context via boundary stub...");
    gatheredData.company = { id: userContext.companyId || "unknown", details: "company stub" };
  }

  if (requiredContext.includes("rag")) {
    logger.info("[Orchestrator] Gathering RAG context via boundary stub...");
    gatheredData.knowledge = "knowledge base stub";
  }

  return gatheredData;
};

import * as skillRegistry from "../skills/registry.js";
import * as toolRegistry from "../tools/registry.js";

/**
 * Boundary for the Skill/Tool registry.
 * Uses the real Registry to resolve and execute capabilities.
 * 
 * @param {Array<string>} capabilities - List of capabilities to execute.
 * @param {import("./orchestrator-context.js").OrchestratorContext} orchestratorContext
 * @returns {Promise<Array<Object>>}
 */
export const executeCapabilitiesBoundary = async (capabilities, orchestratorContext) => {
  const results = [];
  
  if (!capabilities) return results;

  for (const capabilityName of capabilities) {
    logger.info(`[Orchestrator] Looking up capability: ${capabilityName}`);
    
    // Check both registries for the capability
    const skill = skillRegistry.get(capabilityName);
    const tool = toolRegistry.get(capabilityName);

    const capability = skill || tool;

    if (!capability) {
      logger.warn(`[Orchestrator] Capability not found in registry: ${capabilityName}`);
      results.push({
        capability: capabilityName,
        status: "error",
        message: `Capability not found: ${capabilityName}`
      });
      continue;
    }

    try {
      logger.info(`[Orchestrator] Executing capability: ${capabilityName}`);
      // Capabilities contain their own execute function per the contract
      const result = await capability.execute(orchestratorContext.message, orchestratorContext.userContext);
      
      results.push({
        capability: capabilityName,
        status: "success",
        data: result
      });
    } catch (error) {
      logger.error(`[Orchestrator] Capability execution failed: ${capabilityName}`, error);
      results.push({
        capability: capabilityName,
        status: "error",
        message: error.message
      });
    }
  }

  return results;
};
