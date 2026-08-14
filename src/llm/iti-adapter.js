import { config, llmConfig } from "../config/env.js";
import { logger } from "../shared/logger.js";
import { AIMessage } from "@langchain/core/messages";
import { toJsonSchema } from "@langchain/core/utils/json_schema";

/**
 * ITI Gateway LLM Adapter.
 *
 * Implements the minimal interface used by the Wakeel AI application:
 *   - .invoke(prompt)               → AIMessage  (plain text mode)
 *   - .withStructuredOutput(schema) → ITILanguageModel  (structured JSON mode)
 *
 * All requests are sent to:
 *   POST ${LLM_BASE_URL}/student/chat
 *
 * with:
 *   Authorization: Bearer <LLM_API_KEY>
 *   { model_id, messages, system_prompt }
 *
 * The API key is never logged or exposed.
 */
export class ITILanguageModel {
  /**
   * @param {Object} options
   * @param {string} [options.modelName]
   * @param {string} [options.baseURL]
   * @param {string} [options.apiKey]
   * @param {number} [options.temperature]
   * @param {import("zod").ZodSchema|null} [options._schema] - Internal: set by withStructuredOutput
   */
  constructor(options = {}) {
    this.modelName = options.modelName || options.model || config.LLM_MODEL;
    this.baseURL = options.baseURL || config.LLM_BASE_URL;
    this.apiKey = options.apiKey || config.LLM_API_KEY;
    this.temperature = options.temperature !== undefined ? options.temperature : 0;
    this._schema = options._schema || null;
  }

  /**
   * Returns a new ITILanguageModel instance configured to return a
   * parsed object matching the given Zod schema.
   *
   * @param {import("zod").ZodSchema} schema
   * @returns {ITILanguageModel}
   */
  withStructuredOutput(schema) {
    return new ITILanguageModel({
      modelName: this.modelName,
      baseURL: this.baseURL,
      apiKey: this.apiKey,
      temperature: this.temperature,
      _schema: schema,
    });
  }

  /**
   * Invokes the ITI Gateway.
   *
   * In plain-text mode returns an AIMessage.
   * In structured mode (schema set) returns the parsed JS object.
   *
   * @param {string|Array} prompt
   * @returns {Promise<AIMessage|Object>}
   */
  async invoke(prompt) {
    const { userContent, systemPrompt } = this._extractMessages(prompt);

    // In structured mode, inject a JSON schema instruction into the system prompt
    const effectiveSystemPrompt = this._schema
      ? this._buildStructuredSystemPrompt(systemPrompt)
      : systemPrompt;

    const payload = {
      model_id: this.modelName,
      messages: [{ role: "user", content: userContent }],
      system_prompt: effectiveSystemPrompt,
    };

    const url = `${this.baseURL}/student/chat`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      logger.error(`[ITILanguageModel] Gateway error ${response.status}`, { status: response.status });
      throw new Error(`ITI Gateway Error: ${response.status} - ${errText}`);
    }

    const data = await response.json();
    const rawText = (data.output_text || "").trim();

    if (this._schema) {
      return this._parseStructured(rawText);
    }

    return new AIMessage(rawText);
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Normalises the prompt into { userContent, systemPrompt }.
   * Handles strings, LangChain message arrays, and PromptValue objects.
   */
  _extractMessages(prompt) {
    let userContent = "";
    let systemPrompt = "You are a helpful assistant.";

    if (typeof prompt === "string") {
      userContent = prompt;
      return { userContent, systemPrompt };
    }

    // PromptValue from ChatPromptTemplate
    if (prompt && typeof prompt.toChatMessages === "function") {
      return this._extractMessages(prompt.toChatMessages());
    }

    if (Array.isArray(prompt)) {
      for (const msg of prompt) {
        const type = msg._getType ? msg._getType() : (msg.role || msg.type || "");
        const text = msg.content ?? msg.text ?? "";

        if (type === "system" || type === "system") {
          systemPrompt = text;
        } else if (type === "human" || type === "user") {
          userContent = text;
        }
      }
      return { userContent, systemPrompt };
    }

    // Fallback
    userContent = String(prompt);
    return { userContent, systemPrompt };
  }

  /**
   * Builds a system prompt that instructs the model to return strict JSON
   * matching the configured Zod schema.
   */
  _buildStructuredSystemPrompt(baseSystemPrompt) {
    const jsonSchema = toJsonSchema(this._schema);
    return (
      baseSystemPrompt +
      "\n\n" +
      "CRITICAL INSTRUCTION: You MUST respond with ONLY a valid JSON object — no markdown, no backticks, no explanatory text before or after the JSON.\n" +
      "The JSON object MUST match the following JSON Schema exactly:\n\n" +
      JSON.stringify(jsonSchema, null, 2)
    );
  }

  /**
   * Strips optional markdown fences and parses the model output as JSON.
   */
  _parseStructured(rawText) {
    const cleaned = rawText
      .replace(/^```(?:json)?[\r\n]*/i, "")
      .replace(/[\r\n]*```$/i, "")
      .trim();

    try {
      return JSON.parse(cleaned);
    } catch (e) {
      logger.error("[ITILanguageModel] Failed to parse structured JSON output", {
        cleaned,
        error: e.message,
      });
      throw new Error(`ITI Gateway returned invalid JSON: ${e.message}`);
    }
  }
}
