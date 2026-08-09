/**
 * Validation helper for AI Tool objects.
 * A tool must provide name, description, inputSchema, and an execute function.
 * 
 * @param {unknown} tool 
 * @returns {boolean}
 */
export function isAITool(tool) {
  return Boolean(
    tool &&
    typeof tool.name === "string" &&
    typeof tool.description === "string" &&
    tool.inputSchema &&
    typeof tool.execute === "function"
  );
}
