import { z } from "zod";

export const SkillSchema = z.object({
  name: z.string().min(1, "name is required"),
  description: z.string().min(1, "description is required"),
  inputSchema: z.custom((val) => val && typeof val.parse === "function", "inputSchema must be a valid Zod schema"),
  execute: z.custom((val) => typeof val === "function", "execute must be a function"),
});

/**
 * Validation helper for AI Skill objects.
 * 
 * @param {unknown} skill 
 * @returns {boolean}
 */
export function isAISkill(skill) {
  return SkillSchema.safeParse(skill).success;
}
