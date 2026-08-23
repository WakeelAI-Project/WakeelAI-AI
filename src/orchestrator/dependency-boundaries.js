import { logger } from "../shared/logger.js";
import { getEmployeeContext } from "../services/employee-context.service.js";
import { getCompanyContext } from "../services/company-context.service.js";
import { resolveLeaveDraftArgs } from "./leave-draft-context.js";

const buildContextError = (err, source) => ({
  error: {
    source,
    code: err?.code || "CONTEXT_RETRIEVAL_FAILED",
    status: err?.status || null,
    message: err?.message || "Failed to retrieve context.",
  },
});

/**
 * Boundary for context gatherers (RAG, Employee, Company).
 * 
 * @param {Array<string>} requiredContext - e.g., ["employee", "company", "rag"]
 * @param {import("../contracts/index.js").AIContext} userContext
 * @returns {Promise<Object>}
 */
export const gatherContextBoundary = async (requiredContext, userContext) => {
  const gatheredData = {};

  logger.info("[ContextBoundary] gatherContextBoundary called");
  logger.info(`[ContextBoundary] requested contexts = ${JSON.stringify(requiredContext || [])}`);
  logger.info(
    "[ContextBoundary] trusted context received. " +
    `userId present=${Boolean(userContext?.userId)} ` +
    `companyId present=${Boolean(userContext?.companyId)} ` +
    `role present=${Boolean(userContext?.role)}`
  );

  if (!requiredContext) {
    logger.warn("[ContextBoundary] requiredContext missing; returning empty gatheredData");
    return gatheredData;
  }

  if (requiredContext.includes("employee")) {
    logger.info("[ContextBoundary] Processing context type = employee");
    logger.info("[Orchestrator] Gathering employee context via boundary...");
    try {
      gatheredData.employee = await getEmployeeContext(userContext);
      logger.info("[ContextBoundary] Employee context successfully gathered");
    } catch (err) {
      logger.error(`[Orchestrator] Failed to gather employee context: ${err.message}`);
      gatheredData.employee = buildContextError(err, "employee");
    }
  }
  
  if (requiredContext.includes("company")) {
    logger.info("[ContextBoundary] Processing context type = company");
    logger.info("[Orchestrator] Gathering company context via boundary...");
    try {
      logger.info("[ContextBoundary] Calling CompanyContextService...");
      gatheredData.company = await getCompanyContext(userContext);
      logger.info(
        "[ContextBoundary] Company context successfully gathered. " +
        `company context present=${Boolean(gatheredData.company)} ` +
        `company name present=${Boolean(gatheredData.company?.companyName)}`
      );
    } catch (err) {
      logger.error(`[Orchestrator] Failed to gather company context: ${err.message}`);
      gatheredData.company = buildContextError(err, "company");
    }
  }

  // Note: "rag" context (company policy / labor law document retrieval) is NOT
  // handled here. It's deliberately executed as a capability (company_policy /
  // labor_law skills, see executeCapabilitiesBoundary below) rather than a
  // context gatherer, because retrieval needs the LLM-driven query construction
  // and prompting each skill performs internally. Previously this branch wrote
  // a literal "knowledge base stub" placeholder into gatheredData, which was
  // never consumed by anything and could confuse the final LLM into thinking
  // a (contentless) knowledge lookup had already happened.

  logger.info(`[ContextBoundary] Returning gatheredData keys = ${JSON.stringify(Object.keys(gatheredData))}`);
  return gatheredData;
};

import * as skillRegistry from "../skills/registry.js";
import * as toolRegistry from "../tools/registry.js";
import calculationSkill from "../skills/calculation/calculation.skill.js";
import documentGenerationSkill from "../skills/document-generation/document-generation.skill.js";
import laborLawSkill from "../skills/labor-law/labor-law.skill.js";
import companyPolicySkill from "../skills/company-policy/company-policy.skill.js";
import createLeaveDraftTool from "../tools/create-leave-draft.tool.js";
import submitLeaveDraftTool from "../tools/submit-leave-draft.tool.js";
import cancelLeaveDraftTool from "../tools/cancel-leave-draft.tool.js";

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
registerKnownSkill(laborLawSkill);
registerKnownSkill(companyPolicySkill);
registerKnownTool(createLeaveDraftTool);
registerKnownTool(submitLeaveDraftTool);
registerKnownTool(cancelLeaveDraftTool);

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
      const baseArgs = orchestratorContext.intent?.arguments || {};
      let args = { ...baseArgs };
      if (orchestratorContext.userContext?.field_values) {
        Object.assign(args, orchestratorContext.userContext.field_values);
      }

      // The LLM never sees a leave request id (history is normalized down to
      // { role, content }), so resolve it deterministically from the persisted
      // result_card / actions before the leave tools run.
      args = resolveLeaveDraftArgs({
        capability: capabilityName,
        args,
        message: orchestratorContext.message,
        conversationMessages: orchestratorContext.conversationMessages,
      });

      const result = await capability.execute(orchestratorContext.message, orchestratorContext.userContext, args, orchestratorContext.gatheredData);
      
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
