import { z } from "zod";
import { logger } from "../../shared/logger.js";
import { generateDocument } from "../../services/document-generation.service.js";

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
  async execute(message, context) {
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

    const result = await generateDocument({
      message,
      aiContext: context,
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
