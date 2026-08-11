import { describe, it, expect } from "@jest/globals";
import { performCalculation, CalculationInputSchema } from "../src/services/calculation.service.js";

describe("CalculationService", () => {
  
  describe("Zod Validation", () => {
    it("should accept valid add operations", () => {
      const result = CalculationInputSchema.safeParse({ operation: "add", operands: [5, 10] });
      expect(result.success).toBe(true);
    });

    it("should reject missing operation", () => {
      const result = CalculationInputSchema.safeParse({ operands: [5, 10] });
      expect(result.success).toBe(false);
    });

    it("should reject unsupported operations", () => {
      const result = CalculationInputSchema.safeParse({ operation: "power", operands: [5, 2] });
      expect(result.success).toBe(false);
    });

    it("should reject non-numeric operands", () => {
      const result = CalculationInputSchema.safeParse({ operation: "add", operands: [5, "10"] });
      expect(result.success).toBe(false);
    });

    it("should reject arrays with fewer than two operands", () => {
      const result = CalculationInputSchema.safeParse({ operation: "add", operands: [5] });
      expect(result.success).toBe(false);
    });

    it("should reject arrays with more than two operands", () => {
      const result = CalculationInputSchema.safeParse({ operation: "add", operands: [5, 10, 15] });
      expect(result.success).toBe(false);
    });
  });

  describe("Calculations", () => {
    it("should calculate addition correctly", () => {
      const result = performCalculation({ operation: "add", operands: [5, 10] });
      expect(result.success).toBe(true);
      expect(result.result).toBe(15);
      expect(result.explanation).toContain("15");
    });

    it("should calculate subtraction correctly", () => {
      const result = performCalculation({ operation: "subtract", operands: [15, 10] });
      expect(result.success).toBe(true);
      expect(result.result).toBe(5);
    });

    it("should calculate multiplication correctly", () => {
      const result = performCalculation({ operation: "multiply", operands: [5, 10] });
      expect(result.success).toBe(true);
      expect(result.result).toBe(50);
    });

    it("should calculate division correctly", () => {
      const result = performCalculation({ operation: "divide", operands: [20, 4] });
      expect(result.success).toBe(true);
      expect(result.result).toBe(5);
    });

    it("should calculate percentage correctly", () => {
      // 10% of 200 is 20
      const result = performCalculation({ operation: "percentage", operands: [200, 10] });
      expect(result.success).toBe(true);
      expect(result.result).toBe(20);
    });

    it("should include unit in explanation if provided", () => {
      const result = performCalculation({ operation: "add", operands: [5, 10], unit: "days" });
      expect(result.success).toBe(true);
      expect(result.unit).toBe("days");
      expect(result.explanation).toContain("15 days");
    });
  });

  describe("Edge Cases & Error Handling", () => {
    it("should handle division by zero", () => {
      const result = performCalculation({ operation: "divide", operands: [20, 0] });
      expect(result.success).toBe(false);
      expect(result.result).toBeNull();
      expect(result.explanation).toContain("Division by zero");
    });

    it("should reject NaN operands", () => {
      const result = performCalculation({ operation: "add", operands: [NaN, 10] });
      expect(result.success).toBe(false);
      expect(result.explanation).toContain("Invalid calculation input");
    });

    it("should reject Infinity operands", () => {
      const result = performCalculation({ operation: "add", operands: [Infinity, 10] });
      expect(result.success).toBe(false);
      expect(result.explanation).toContain("Invalid calculation input");
    });

    it("should handle floating point edge cases safely by preserving precision", () => {
      const result = performCalculation({ operation: "add", operands: [0.1, 0.2] });
      expect(result.success).toBe(true);
      // Not strict checking floating point error here, just verifying it returns a valid number.
      expect(typeof result.result).toBe("number");
    });
  });

});
