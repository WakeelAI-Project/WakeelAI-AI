import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { config } from "../../config/env.js";
import { logger } from "../../shared/logger.js";
import { performCalculation, CalculationInputSchema } from "../../services/calculation.service.js";

// Input schema required for SkillRegistry registration
export const calculationInputSchema = z.object({
  message: z.string().describe("The user's calculation request")
});

const llm = new ChatOpenAI({
  apiKey: config.LLM_API_KEY,
  modelName: config.LLM_MODEL,
  temperature: 0,
});

const calculationParser = llm.withStructuredOutput(CalculationInputSchema, {
  name: "parse_calculation_request"
});

/**
 * Calculation AI Skill
 */
const calculationSkill = {
  name: "calculation",
  description: "Performs deterministic mathematical operations such as addition, subtraction, multiplication, division, and percentage calculations. Do not use for generic conversation.",
  inputSchema: calculationInputSchema,

  /**
   * Executes the calculation skill.
   * @param {string} message - The raw user message containing the calculation intent.
   * @param {import("../../contracts/index.js").AIContext} context - The user context.
   * @returns {Promise<import("../../contracts/index.js").SkillResult>}
   */
  async execute(message, context) {
    logger.info(`[CalculationSkill] Executing calculation for message: "${message}"`);
    try {
      // 1. Use LLM to parse the unstructured message into structured inputs
      logger.info(`[CalculationSkill] Parsing natural language into structured inputs`);
      const parsedInputs = await calculationParser.invoke(`Extract the mathematical operation, exactly two operands, and an optional unit from this request. 
If it is a percentage calculation, the operation is 'percentage', the first operand is the base value, and the second operand is the percentage amount (e.g., 10% of 200 -> operands: [200, 10]).

User Request: "${message}"`);

      // 2. Perform the deterministic calculation using the service
      logger.info(`[CalculationSkill] Forwarding structured inputs to CalculationService`);
      const calcResult = performCalculation(parsedInputs);

      if (!calcResult.success) {
        logger.warn(`[CalculationSkill] CalculationService reported failure: ${calcResult.explanation}`);
        return {
          success: false,
          data: null,
          message: calcResult.explanation,
          sources: [],
          action: null
        };
      }

      logger.info(`[CalculationSkill] Calculation successful`);
      
      // 3. Return the successful result in the standard SkillResult shape
      return {
        success: true,
        data: calcResult,
        message: calcResult.explanation,
        sources: [],
        action: null
      };

    } catch (error) {
      logger.error(`[CalculationSkill] Failed to execute calculation skill: ${error.message}`);
      return {
        success: false,
        data: null,
        message: "An error occurred while attempting to parse or execute the calculation.",
        sources: [],
        action: null
      };
    }
  }
};

export default calculationSkill;
