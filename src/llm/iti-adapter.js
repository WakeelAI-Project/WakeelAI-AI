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
    const { messages, systemPrompt } = this._extractMessages(prompt);

    // In structured mode, inject a JSON schema instruction into the system prompt
    const effectiveSystemPrompt = this._schema
      ? this._buildStructuredSystemPrompt(systemPrompt)
      : systemPrompt;

    const payload = {
      model_id: this.modelName,
      messages,
      system_prompt: effectiveSystemPrompt,
    };

    const url = `${this.baseURL}/student/chat`;
    const maxRetries = 3;
    let attempt = 0;

    while (attempt <= maxRetries) {
      const startTime = Date.now();
      try {
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
          const status = response.status;

          logger.error(`[ITILanguageModel] Gateway HTTP error ${status}`, { 
            status,
            url,
            model: this.modelName,
            durationMs: Date.now() - startTime,
            attempt,
          });

          if (status === 413) {
            const err = new Error(`ITI Gateway Payload Too Large: ${status} - ${errText}`);
            err.code = "PAYLOAD_TOO_LARGE";
            err.status = 413;
            throw err;
          }

          const isRetryable = status === 429 || (status >= 500 && status <= 504);
          if (!isRetryable || attempt >= maxRetries) {
            const err = new Error(`ITI Gateway Error: ${status} - ${errText}`);
            err.code = status === 429 ? "RATE_LIMIT_EXCEEDED" : "LLM_PROVIDER_ERROR";
            err.status = status;
            throw err;
          }

          attempt += 1;
          const retryAfterHeader = response.headers?.get?.("retry-after") || response.headers?.get?.("Retry-After");
          let retryAfterMs = null;
          if (retryAfterHeader) {
            const sec = parseFloat(retryAfterHeader);
            if (!Number.isNaN(sec) && sec > 0) retryAfterMs = sec * 1000;
          }

          const backoffDelay = Math.min(500 * Math.pow(2, attempt - 1), 4000) + Math.random() * 200;
          const delayMs = Math.min(retryAfterMs ?? backoffDelay, 5000);

          logger.warn(`[ITILanguageModel] Retry ${attempt}/${maxRetries} after ${Math.round(delayMs)}ms due to HTTP ${status}`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        const data = await response.json();
        const rawText = (data.output_text || "").trim();

        if (this._schema) {
          return this._parseStructured(rawText);
        }

        return new AIMessage(rawText);
      } catch (e) {
        if (e.code === "PAYLOAD_TOO_LARGE" || e.code === "RATE_LIMIT_EXCEEDED" || attempt >= maxRetries) {
          logger.error("[ITILanguageModel] Request failed fatally", {
            provider: "ITI Gateway",
            url,
            model: this.modelName,
            errorName: e.name,
            errorMessage: e.message,
            errorCode: e.code || e.cause?.code,
            errorCause: e.cause?.message,
            stack: e.stack,
            durationMs: Date.now() - startTime,
          });
          throw e;
        }

        attempt += 1;
        if (attempt > maxRetries) {
          throw e;
        }

        const delayMs = Math.min(500 * Math.pow(2, attempt - 1), 4000) + Math.random() * 200;
        logger.warn(`[ITILanguageModel] Network error on attempt ${attempt}/${maxRetries}, retrying in ${Math.round(delayMs)}ms: ${e.message}`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Normalises the prompt into { messages, systemPrompt }.
   * Handles strings, LangChain message arrays, and PromptValue objects.
   */
  _extractMessages(prompt) {
    let messages = [];
    let systemPrompt = "You are a helpful assistant.";

    if (typeof prompt === "string") {
      messages = [{ role: "user", content: prompt }];
      return { messages, systemPrompt };
    }

    // PromptValue from ChatPromptTemplate
    if (prompt && typeof prompt.toChatMessages === "function") {
      return this._extractMessages(prompt.toChatMessages());
    }

    if (Array.isArray(prompt)) {
      for (const msg of prompt) {
        const type = msg._getType ? msg._getType() : (msg.role || msg.type || "");
        const text = msg.content ?? msg.text ?? "";
        const content = typeof text === "string" ? text : String(text ?? "");

        if (!content.trim()) {
          continue;
        }

        if (type === "system") {
          systemPrompt = content;
        } else if (type === "human" || type === "user") {
          messages.push({ role: "user", content });
        } else if (type === "ai" || type === "assistant") {
          messages.push({ role: "assistant", content });
        }
      }

      return {
        messages: messages.length ? messages : [{ role: "user", content: "" }],
        systemPrompt,
      };
    }

    // Fallback
    messages = [{ role: "user", content: String(prompt) }];
    return { messages, systemPrompt };
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
