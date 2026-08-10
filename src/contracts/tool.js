import { z } from "zod";

export const ToolSchema = z.object({
  name: z.string().min(1, "name is required"),
  description: z.string().min(1, "description is required"),
  inputSchema: z.custom((val) => val && typeof val.parse === "function", "inputSchema must be a valid Zod schema"),
  execute: z.custom((val) => typeof val === "function", "execute must be a function"),
});

/**
 * Validation helper for AI Tool objects.
 * 
 * @param {unknown} tool 
 * @returns {boolean}
 */
export function isAITool(tool) {
  return ToolSchema.safeParse(tool).success;
}
