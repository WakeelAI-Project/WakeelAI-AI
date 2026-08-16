import { logger } from "../shared/logger.js";
import { config, llmConfig } from "../config/env.js";
import { ITILanguageModel } from "./iti-adapter.js";
import { GroqLanguageModel } from "./groq-adapter.js";

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

  return new ITILanguageModel({
    ...llmConfig,
    ...options,
  });
};
