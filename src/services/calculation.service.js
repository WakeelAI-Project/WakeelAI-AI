import { z } from "zod";
import { logger } from "../shared/logger.js";

// Input schema for deterministic calculation requests
export const CalculationInputSchema = z.object({
  operation: z.enum(["add", "subtract", "multiply", "divide", "percentage"]),
  operands: z.array(z.number()).min(2).max(2, "Exactly two operands are required for calculations."),
  unit: z.string().optional()
});

/**
 * Performs a deterministic mathematical calculation.
 * 
 * @param {Object} input
 * @param {string} input.operation - The mathematical operation
 * @param {number[]} input.operands - Exactly two numeric operands
 * @param {string} [input.unit] - Optional unit for the result (e.g., 'days', 'EGP')
 * @returns {Object} Result object complying with the contract
 */
export const performCalculation = (input) => {
  logger.info(`[CalculationService] Validating calculation request`);
  const parsed = CalculationInputSchema.safeParse(input);

  if (!parsed.success) {
    logger.warn(`[CalculationService] Invalid calculation input: ${parsed.error.message}`);
    return {
      success: false,
      result: null,
      unit: "",
      explanation: `Invalid calculation input: ${parsed.error.message}`
    };
  }

  const { operation, operands, unit = "" } = parsed.data;
  const [a, b] = operands;

  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return {
      success: false,
      result: null,
      unit: "",
      explanation: "Operands must be finite numbers."
    };
  }

  let result = 0;
  let operationName = "";

  try {
    switch (operation) {
      case "add":
        result = a + b;
        operationName = "addition";
        break;
      case "subtract":
        result = a - b;
        operationName = "subtraction";
        break;
      case "multiply":
        result = a * b;
        operationName = "multiplication";
        break;
      case "divide":
        if (b === 0) {
          throw new Error("Division by zero is not allowed.");
        }
        result = a / b;
        operationName = "division";
        break;
      case "percentage":
        // percentage(value, percent) = (value * percent) / 100
        result = (a * b) / 100;
        operationName = "percentage";
        break;
      default:
        throw new Error(`Unsupported operation: ${operation}`);
    }

    if (!Number.isFinite(result)) {
      throw new Error("Calculation resulted in a non-finite value.");
    }

    logger.info(`[CalculationService] Successfully performed ${operationName}`);

    return {
      success: true,
      result,
      unit,
      explanation: `The result of the ${operationName} is ${result}${unit ? ' ' + unit : ''}.`
    };
  } catch (error) {
    logger.error(`[CalculationService] Error performing calculation: ${error.message}`);
    return {
      success: false,
      result: null,
      unit: "",
      explanation: error.message
    };
  }
};
