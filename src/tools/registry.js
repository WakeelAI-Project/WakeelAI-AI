import { logger } from "../shared/logger.js";
import { ToolSchema } from "../contracts/tool.js";

const tools = new Map();

/**
 * Registers a new AI tool.
 * 
 * @param {Object} tool 
 * @throws {Error} if validation fails or duplicate name
 */
export function register(tool) {
  const parsed = ToolSchema.safeParse(tool);
  if (!parsed.success) {
    logger.error(`[ToolRegistry] Failed to register tool: Invalid definition`);
    throw new Error(`Invalid tool definition: ${parsed.error.message}`);
  }

  const { name } = parsed.data;
  if (tools.has(name)) {
    logger.error(`[ToolRegistry] Tool already registered: ${name}`);
    throw new Error(`Tool with name "${name}" is already registered.`);
  }

  tools.set(name, tool);
  logger.info(`[ToolRegistry] Registered tool: ${name}`);
}

/**
 * Retrieves a registered tool by name.
 * 
 * @param {string} name 
 * @returns {Object|null}
 */
export function get(name) {
  return tools.get(name) || null;
}

/**
 * Checks if a tool is registered.
 * 
 * @param {string} name 
 * @returns {boolean}
 */
export function has(name) {
  return tools.has(name);
}

/**
 * Lists metadata for all registered tools.
 * 
 * @returns {Array<{name: string, description: string}>}
 */
export function list() {
  const list = [];
  for (const [name, tool] of tools.entries()) {
    list.push({ name, description: tool.description });
  }
  return list;
}

/**
 * Clears the registry (useful for testing).
 */
export function clear() {
  tools.clear();
}
