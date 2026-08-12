import { logger } from "../shared/logger.js";
import { getEmployeeContext } from "../services/employee-context.service.js";
import { getCompanyContext } from "../services/company-context.service.js";

/**
 * Boundary for context gatherers (RAG, Employee, Company).
 * 
 * @param {Array<string>} requiredContext - e.g., ["employee", "company", "rag"]
 * @param {import("../contracts/index.js").AIContext} userContext
 * @returns {Promise<Object>}
 */
export const gatherContextBoundary = async (requiredContext, userContext) => {
  const gatheredData = {};

  if (!requiredContext) return gatheredData;

  if (requiredContext.includes("employee")) {
    logger.info("[Orchestrator] Gathering employee context via boundary...");
    try {
      gatheredData.employee = await getEmployeeContext(userContext);
    } catch (err) {
      logger.error(`[Orchestrator] Failed to gather employee context: ${err.message}`);
      gatheredData.employee = { error: "Failed to retrieve employee context." };
    }
  }
  
  if (requiredContext.includes("company")) {
    logger.info("[Orchestrator] Gathering company context via boundary...");
    try {
      gatheredData.company = await getCompanyContext(userContext);
    } catch (err) {
      logger.error(`[Orchestrator] Failed to gather company context: ${err.message}`);
      gatheredData.company = { error: "Failed to retrieve company context." };
    }
  }

  if (requiredContext.includes("rag")) {
    logger.info("[Orchestrator] Gathering RAG context via boundary stub...");
    gatheredData.knowledge = "knowledge base stub";
  }

  return gatheredData;
};

import * as skillRegistry from "../skills/registry.js";
import * as toolRegistry from "../tools/registry.js";
import calculationSkill from "../skills/calculation/calculation.skill.js";
import documentGenerationSkill from "../skills/document-generation/document-generation.skill.js";
import leaveRequestTool from "../tools/leave-request.tool.js";

// Register known skills/tools
const registerKnownSkill = (skill) => {
  if (!skillRegistry.has(skill.name)) {
    skillRegistry.register(skill);
  }
};

const registerKnownTool = (tool) => {
  if (!toolRegistry.has(tool.name)) {
    toolRegistry.register(tool);
  }
};

registerKnownSkill(calculationSkill);
registerKnownSkill(documentGenerationSkill);
registerKnownTool(leaveRequestTool);

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
