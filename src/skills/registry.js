import { logger } from "../shared/logger.js";
import { SkillSchema } from "../contracts/skill.js";

const skills = new Map();

/**
 * Registers a new AI skill.
 * 
 * @param {Object} skill 
 * @throws {Error} if validation fails or duplicate name
 */
export function register(skill) {
  const parsed = SkillSchema.safeParse(skill);
  if (!parsed.success) {
    logger.error(`[SkillRegistry] Failed to register skill: Invalid definition`);
    throw new Error(`Invalid skill definition: ${parsed.error.message}`);
  }

  const { name } = parsed.data;
  if (skills.has(name)) {
    logger.error(`[SkillRegistry] Skill already registered: ${name}`);
    throw new Error(`Skill with name "${name}" is already registered.`);
  }

  skills.set(name, skill);
  logger.info(`[SkillRegistry] Registered skill: ${name}`);
}

/**
 * Retrieves a registered skill by name.
 * 
 * @param {string} name 
 * @returns {Object|null}
 */
export function get(name) {
  return skills.get(name) || null;
}

/**
 * Checks if a skill is registered.
 * 
 * @param {string} name 
 * @returns {boolean}
 */
export function has(name) {
  return skills.has(name);
}

/**
 * Lists metadata for all registered skills.
 * 
 * @returns {Array<{name: string, description: string}>}
 */
export function list() {
  const list = [];
  for (const [name, skill] of skills.entries()) {
    list.push({ name, description: skill.description });
  }
  return list;
}

/**
 * Clears the registry (useful for testing).
 */
export function clear() {
  skills.clear();
}
