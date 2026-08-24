import { logger } from "../shared/logger.js";
import { config } from "../config/env.js";
import { AIMessage } from "@langchain/core/messages";
import { toJsonSchema } from "@langchain/core/utils/json_schema";

/**
 * OpenAI-compatible Groq LLM adapter.
 * Keeps the same minimal surface used by the app:
 *   - .invoke(prompt)
 *   - .withStructuredOutput(schema)
 */
export class GroqLanguageModel {
  constructor(options = {}) {
    this.modelName = options.modelName || options.model || config.LLM_MODEL;
    this.baseURL =
      options.baseURL ||
      options.baseUrl ||
      config.LLM_BASE_URL ||
      "https://api.groq.com/openai/v1";
    this.apiKey = options.apiKey || config.LLM_API_KEY;
    this.temperature =
      options.temperature !== undefined ? options.temperature : 0;
    this._schema = options._schema || null;
    this.providerName = "groq";
  }

  withStructuredOutput(schema) {
    return new GroqLanguageModel({
      modelName: this.modelName,
      baseURL: this.baseURL,
      apiKey: this.apiKey,
      temperature: this.temperature,
      _schema: schema,
    });
  }

  async invoke(prompt) {
    const { messages, systemPrompt } = this._extractMessages(prompt);
    const effectiveSystemPrompt = this._schema
      ? this._buildStructuredSystemPrompt(systemPrompt)
      : systemPrompt;

    const payload = {
      model: this.modelName,
      temperature: this.temperature,
      messages: [
        ...(effectiveSystemPrompt
          ? [{ role: "system", content: effectiveSystemPrompt }]
          : []),
        ...messages,
      ],
    };

    const url = `${this.baseURL.replace(/\/$/, "")}/chat/completions`;
    const maxRetries = 3;
    let attempt = 0;

    while (attempt <= maxRetries) {
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

          logger.error("[GroqLanguageModel] Gateway HTTP error", {
            status,
            url,
            model: this.modelName,
            provider: this.providerName,
            attempt,
          });

          if (status === 413) {
            const err = new Error(`Groq Payload Too Large: ${status} - ${errText}`);
            err.code = "PAYLOAD_TOO_LARGE";
            err.status = 413;
            throw err;
          }

          const isRetryable = status === 429 || (status >= 500 && status <= 504);
          if (!isRetryable || attempt >= maxRetries) {
            const err = new Error(`Groq API Error: ${status} - ${errText}`);
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

          logger.warn(`[GroqLanguageModel] Retry ${attempt}/${maxRetries} after ${Math.round(delayMs)}ms due to HTTP ${status}`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;

        if (this._schema) {
          if (typeof content !== "string" || !content.trim()) {
            throw new Error(
              "Groq structured output response did not include text content.",
            );
          }
          return this._parseStructured(content);
        }

        return new AIMessage(content || "");
      } catch (error) {
        if (error.code === "PAYLOAD_TOO_LARGE" || error.code === "RATE_LIMIT_EXCEEDED" || attempt >= maxRetries) {
          logger.error("[GroqLanguageModel] Request failed fatally", {
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

        const delayMs = Math.min(500 * Math.pow(2, attempt - 1), 4000) + Math.random() * 200;
        logger.warn(`[GroqLanguageModel] Network error on attempt ${attempt}/${maxRetries}, retrying in ${Math.round(delayMs)}ms: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  _extractMessages(prompt) {
    let messages = [];
    let systemPrompt = "You are a helpful assistant.";

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
        "[GroqLanguageModel] Failed to parse structured JSON output",
        {
          cleaned,
          error: error.message,
        },
      );
      throw new Error(`Groq returned invalid JSON: ${error.message}`);
    }
  }
}
