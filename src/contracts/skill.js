/**
 * Validation helper for AI Skill objects.
 * A skill must provide name, description, inputSchema, and an execute function.
 * 
 * @param {unknown} skill 
 * @returns {boolean}
 */
export function isAISkill(skill) {
  return Boolean(
    skill &&
    typeof skill.name === "string" &&
    typeof skill.description === "string" &&
    skill.inputSchema &&
    typeof skill.execute === "function"
  );
}
