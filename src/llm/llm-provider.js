import { logger } from "../shared/logger.js";
import { config, llmConfig } from "../config/env.js";
import { ITILanguageModel } from "./iti-adapter.js";
import { GroqLanguageModel } from "./groq-adapter.js";
import { GoogleGeminiLanguageModel } from "./google-adapter.js";

export const createLLM = (options = {}) => {
  const provider = (
    options.provider ||
    llmConfig.provider ||
    config.LLM_PROVIDER ||
    "iti"
  ).toLowerCase();

  logger.info(`[LLM] Provider: ${provider}`);

  if (provider === "groq") {
    return new GroqLanguageModel({
      ...llmConfig,
      ...options,
    });
  }

  if (provider === "google") {
    return new GoogleGeminiLanguageModel({
      ...llmConfig,
      baseURL:
        options.googleBaseURL ||
        options.baseURL ||
        options.baseUrl ||
        config.GOOGLE_BASE_URL ||
        "https://generativelanguage.googleapis.com/v1beta",
      apiKey:
        options.googleApiKey ||
        options.apiKey ||
        config.GOOGLE_API_KEY ||
        config.LLM_API_KEY,
      modelName:
        options.googleModel ||
        options.modelName ||
        options.model ||
        config.GOOGLE_MODEL ||
        config.LLM_MODEL,
      ...options,
    });
  }

  return new ITILanguageModel({
    ...llmConfig,
    ...options,
  });
};
