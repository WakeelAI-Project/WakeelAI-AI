import { logger } from "../shared/logger.js";
import { config } from "../config/env.js";
import { AIMessage } from "@langchain/core/messages";
import { toJsonSchema } from "@langchain/core/utils/json_schema";

/**
 * Google Gemini Developer API / Google AI Studio LLM adapter.
 *
 * Implements the minimal interface used by the Wakeel AI application:
 *   - .invoke(prompt)               → AIMessage (plain text mode)
 *   - .withStructuredOutput(schema) → GoogleGeminiLanguageModel (structured JSON mode)
 *
 * All requests are sent to:
 *   POST ${baseURL}/models/${model}:generateContent
 *
 * with:
 *   x-goog-api-key: <GOOGLE_API_KEY>
 *   { contents, systemInstruction, generationConfig }
 *
 * The API key is never logged or exposed.
 */
export class GoogleGeminiLanguageModel {
  /**
   * @param {Object} options
   * @param {string} [options.modelName]
   * @param {string} [options.model]
   * @param {string} [options.googleModel]
   * @param {string} [options.baseURL]
   * @param {string} [options.baseUrl]
   * @param {string} [options.googleBaseURL]
   * @param {string} [options.apiKey]
   * @param {string} [options.googleApiKey]
   * @param {number} [options.temperature]
   * @param {import("zod").ZodSchema|null} [options._schema] - Internal: set by withStructuredOutput
   */
  constructor(options = {}) {
    this.modelName =
      options.googleModel ||
      options.modelName ||
      options.model ||
      config.GOOGLE_MODEL ||
      config.LLM_MODEL;
    this.baseURL =
      options.googleBaseURL ||
      options.baseURL ||
      options.baseUrl ||
      config.GOOGLE_BASE_URL ||
      "https://generativelanguage.googleapis.com/v1beta";
    this.apiKey =
      options.googleApiKey ||
      options.apiKey ||
      config.GOOGLE_API_KEY ||
      config.LLM_API_KEY;
    this.temperature =
      options.temperature !== undefined ? options.temperature : 0;
    this._schema = options._schema || null;
    this.providerName = "google";
  }

  /**
   * Returns a new GoogleGeminiLanguageModel instance configured to return a
   * parsed object matching the given Zod schema.
   *
   * @param {import("zod").ZodSchema} schema
   * @returns {GoogleGeminiLanguageModel}
   */
  withStructuredOutput(schema) {
    return new GoogleGeminiLanguageModel({
      modelName: this.modelName,
      baseURL: this.baseURL,
      apiKey: this.apiKey,
      temperature: this.temperature,
      _schema: schema,
    });
  }

  /**
   * Invokes the Google Gemini generateContent API.
   *
   * In plain-text mode returns an AIMessage.
   * In structured mode (schema set) returns the parsed JS object.
   *
   * @param {string|Array} prompt
   * @returns {Promise<AIMessage|Object>}
   */
  async invoke(prompt) {
    const { messages, systemPrompt } = this._extractMessages(prompt);
    const effectiveSystemPrompt = this._schema
      ? this._buildStructuredSystemPrompt(systemPrompt)
      : systemPrompt;

    const contents = this._formatGeminiContents(messages);
    const systemInstruction = this._formatSystemInstruction(effectiveSystemPrompt);

    const payload = {
      contents,
      ...(systemInstruction && { systemInstruction }),
      generationConfig: {
        temperature: this.temperature,
      },
    };

    const cleanBaseUrl = this.baseURL.replace(/\/$/, "");
    const encodedModel = encodeURIComponent(this.modelName);
    const url = `${cleanBaseUrl}/models/${encodedModel}:generateContent`;

    const maxRetries = 3;
    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "x-goog-api-key": this.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => "");
          const status = response.status;

          logger.error("[GoogleGeminiLanguageModel] Gateway HTTP error", {
            status,
            url,
            model: this.modelName,
            provider: this.providerName,
            attempt,
          });

          if (status === 413) {
            const err = new Error(
              `Google Gemini Payload Too Large: ${status} - ${errText}`,
            );
            err.code = "PAYLOAD_TOO_LARGE";
            err.status = 413;
            throw err;
          }

          const isRetryable =
            status === 429 || (status >= 500 && status <= 504);
          if (!isRetryable || attempt >= maxRetries) {
            const err = new Error(`Google Gemini API Error: ${status} - ${errText}`);
            err.code =
              status === 429 ? "RATE_LIMIT_EXCEEDED" : "LLM_PROVIDER_ERROR";
            err.status = status;
            throw err;
          }

          attempt += 1;
          const retryAfterHeader =
            response.headers?.get?.("retry-after") ||
            response.headers?.get?.("Retry-After");
          let retryAfterMs = null;
          if (retryAfterHeader) {
            const sec = parseFloat(retryAfterHeader);
            if (!Number.isNaN(sec) && sec > 0) retryAfterMs = sec * 1000;
          }

          const backoffDelay =
            Math.min(500 * Math.pow(2, attempt - 1), 4000) +
            Math.random() * 200;
          const delayMs = Math.min(retryAfterMs ?? backoffDelay, 5000);

          logger.warn(
            `[GoogleGeminiLanguageModel] Retry ${attempt}/${maxRetries} after ${Math.round(delayMs)}ms due to HTTP ${status}`,
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        const data = await response.json();
        const candidate = data?.candidates?.[0];
        const content =
          candidate?.content?.parts
            ?.map((part) => part.text || "")
            .join("") || "";

        if (this._schema) {
          if (typeof content !== "string" || !content.trim()) {
            throw new Error(
              "Google Gemini structured output response did not include text content.",
            );
          }
          return this._parseStructured(content);
        }

        const aiMessage = new AIMessage(content || "");
        if (data?.usageMetadata) {
          aiMessage.response_metadata = { usage: data.usageMetadata };
        }
        return aiMessage;
      } catch (error) {
        if (
          error.code === "PAYLOAD_TOO_LARGE" ||
          error.code === "RATE_LIMIT_EXCEEDED" ||
          error.code === "LLM_PROVIDER_ERROR" ||
          attempt >= maxRetries
        ) {
          logger.error("[GoogleGeminiLanguageModel] Request failed fatally", {
            provider: this.providerName,
            url,
            model: this.modelName,
            errorName: error.name,
            errorMessage: error.message,
          });
          throw error;
        }

        attempt += 1;
        if (attempt > maxRetries) {
          throw error;
        }

        const delayMs =
          Math.min(500 * Math.pow(2, attempt - 1), 4000) + Math.random() * 200;
        logger.warn(
          `[GoogleGeminiLanguageModel] Network error on attempt ${attempt}/${maxRetries}, retrying in ${Math.round(delayMs)}ms: ${error.message}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  _extractMessages(prompt) {
    let messages = [];
    let systemPrompt = "";

    if (typeof prompt === "string") {
      messages = [{ role: "user", content: prompt }];
      return { messages, systemPrompt };
    }

    if (prompt && typeof prompt.toChatMessages === "function") {
      return this._extractMessages(prompt.toChatMessages());
    }

    if (Array.isArray(prompt)) {
      for (const msg of prompt) {
        const type = msg?._getType
          ? msg._getType()
          : msg?.role || msg?.type || "";
        const text = msg?.content ?? msg?.text ?? "";
        const content = typeof text === "string" ? text : String(text ?? "");

        if (!content.trim()) continue;

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

    messages = [{ role: "user", content: String(prompt) }];
    return { messages, systemPrompt };
  }

  _formatGeminiContents(messages) {
    return messages.map((msg) => ({
      role:
        msg.role === "assistant" || msg.role === "model" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));
  }

  _formatSystemInstruction(effectiveSystemPrompt) {
    if (!effectiveSystemPrompt || !effectiveSystemPrompt.trim()) {
      return undefined;
    }
    return {
      parts: [{ text: effectiveSystemPrompt }],
    };
  }

  _buildStructuredSystemPrompt(baseSystemPrompt) {
    const jsonSchema = toJsonSchema(this._schema);
    return (
      (baseSystemPrompt || "You are a helpful assistant.") +
      "\n\n" +
      "CRITICAL INSTRUCTION: Return ONLY valid JSON in the final response. No markdown fences, no explanation, no trailing text. The JSON must match this schema exactly:\n\n" +
      JSON.stringify(jsonSchema, null, 2)
    );
  }

  _parseStructured(rawText) {
    const cleaned = rawText
      .replace(/^```(?:json)?[\r\n]*/i, "")
      .replace(/[\r\n]*```$/i, "")
      .trim();

    try {
      return JSON.parse(cleaned);
    } catch (error) {
      logger.error(
        "[GoogleGeminiLanguageModel] Failed to parse structured JSON output",
        {
          cleaned,
          error: error.message,
        },
      );
      throw new Error(`Google Gemini returned invalid JSON: ${error.message}`);
    }
  }
}
