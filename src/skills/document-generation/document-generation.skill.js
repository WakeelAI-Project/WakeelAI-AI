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
