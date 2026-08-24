import { z } from "zod";
import { logger } from "../../shared/logger.js";
import { generateDocument, extractFieldValuesFromMessage } from "../../services/document-generation.service.js";
import { searchEmployeesByNameApi } from "../../integrations/wakeel/employee-api.js";

const NO_TARGET_EMPLOYEE_MESSAGE =
  "To generate a document I need to know which employee it's for. Open the employee's page and use 'Ask AI' there, or tell me the employee's name.";

const missingTargetEmployeeResult = (message = NO_TARGET_EMPLOYEE_MESSAGE) => ({
  success: false,
  data: {
    type: "document_generation",
    status: "error",
    error: {
      code: "MISSING_TARGET_EMPLOYEE",
      status: 400,
    },
  },
  message,
  sources: [],
  action: null,
});

export const documentGenerationInputSchema = z.object({
  message: z.string().describe("The user's document generation request"),
});

const documentGenerationSkill = {
  name: "document_generation",
  description: "Generates HR document drafts from active backend templates, collecting missing required fields before saving.",
  inputSchema: documentGenerationInputSchema,

  /**
   * Executes document generation through the application service.
   *
   * @param {string} message
   * @param {import("../../contracts/index.js").AIContext} context
   * @returns {Promise<import("../../contracts/index.js").SkillResult>}
   */
  async execute(message, context, args = {}, gatheredData = {}) {
    logger.info("[DocumentGenerationSkill] Executing document generation");

    // Role gate: document generation is restricted to HR_Manager only
    const HR_ROLE = "HR_Manager";
    if (context.role !== HR_ROLE) {
      return {
        success: false,
        data: {
          type: "document_generation",
          status: "error",
          error: {
            code: "FORBIDDEN_DOCUMENT_GENERATION",
            status: 403,
          },
        },
        message: "Document generation is available to HR managers only. Please contact your HR department if you need an official document.",
        sources: [],
        action: null,
      };
    }

    if (!context.targetEmployeeId) {
      // FIX-17: no employee scoped yet - e.g. asked from the general Assistant page
      // rather than an employee's own page. Try to resolve one from a name the user
      // typed in the same message before giving up with a friendly instruction.
      const { employee_name: typedName } = extractFieldValuesFromMessage(message, ["employee_name"]);

      if (!typedName) {
        return missingTargetEmployeeResult();
      }

      let matches;
      try {
        const searchResult = await searchEmployeesByNameApi(context, typedName);
        matches = searchResult?.employees || [];
      } catch (error) {
        logger.error(`[DocumentGenerationSkill] Employee name lookup failed: ${error.message}`);
        return missingTargetEmployeeResult();
      }

      if (matches.length === 0) {
        return missingTargetEmployeeResult(
          `I couldn't find an employee named "${typedName}". Please check the spelling, or open their profile page and use 'Ask AI' there.`
        );
      }

      if (matches.length > 1) {
        const names = matches.map((match) => match.full_name).join(", ");
        return missingTargetEmployeeResult(
          `I found more than one employee matching "${typedName}": ${names}. Please use their full name, or open their profile page and use 'Ask AI' there.`
        );
      }

      context = { ...context, targetEmployeeId: matches[0].employee_id };
    }

    const mergedFieldValues = {
      ...(context?.field_values || {}),
      ...(args || {}),
    };

    const effectiveContext = {
      ...context,
      field_values: mergedFieldValues,
    };

    const result = await generateDocument({
      message,
      aiContext: effectiveContext,
      conversationMessages: context.conversationMessages,
    });

    return {
      success: result.success,
      data: {
        type: "document_generation",
        status: result.status,
        missing_fields: result.missing_fields,
        result_card: result.result_card,
        document: result.document,
        error: result.error,
      },
      message: result.message,
      sources: result.sources || [],
      action: null,
    };
  },
};

export default documentGenerationSkill;
