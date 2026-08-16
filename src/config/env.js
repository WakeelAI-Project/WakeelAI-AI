import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  PORT: z
    .string()
    .transform((val) => parseInt(val, 10))
    .default("3000"),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  MONGODB_DB_NAME: z.string().min(1, "MONGODB_DB_NAME is required"),
  LLM_PROVIDER: z.enum(["iti", "groq"]).default("iti"),
  LLM_API_KEY: z.string().min(1, "LLM_API_KEY is required"),
  LLM_MODEL: z.string().min(1, "LLM_MODEL is required"),
  LLM_BASE_URL: z.string().url("LLM_BASE_URL must be a valid URL").optional(),
  HUGGINGFACE_API_KEY: z.string().min(1, "HUGGINGFACE_API_KEY is required"),
  EMBEDDING_PROVIDER: z.string().default("huggingface"),
  EMBEDDING_MODEL: z.string().min(1, "EMBEDDING_MODEL is required"),
  WAKEEL_API_BASE_URL: z
    .string()
    .url("WAKEEL_API_BASE_URL must be a valid URL"),
  WAKEEL_INTERNAL_API_KEY: z
    .string()
    .min(1, "WAKEEL_INTERNAL_API_KEY is required"),
  VECTOR_INDEX_NAME: z.string().min(1, "VECTOR_INDEX_NAME is required"),
  KNOWLEDGE_RETRIEVAL_TOP_K: z
    .string()
    .transform((val) => parseInt(val, 10))
    .refine(
      (val) => Number.isInteger(val) && val > 0,
      "KNOWLEDGE_RETRIEVAL_TOP_K must be a positive integer",
    )
    .default("5"),
  KNOWLEDGE_CHUNK_SIZE: z
    .string()
    .transform((val) => parseInt(val, 10))
    .refine(
      (val) => Number.isInteger(val) && val > 0,
      "KNOWLEDGE_CHUNK_SIZE must be a positive integer",
    )
    .default("1200"),
  INITIAL_LABOR_LAW_DOCUMENT_ID: z
    .string()
    .min(1, "INITIAL_LABOR_LAW_DOCUMENT_ID is required"),
  INITIAL_LABOR_LAW_TITLE: z
    .string()
    .min(1, "INITIAL_LABOR_LAW_TITLE is required"),
  INITIAL_LABOR_LAW_VERSION: z
    .string()
    .min(1, "INITIAL_LABOR_LAW_VERSION is required"),
  INITIAL_LABOR_LAW_SOURCE_PATH: z
    .string()
    .min(1, "INITIAL_LABOR_LAW_SOURCE_PATH is required"),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success && process.env.NODE_ENV !== "test") {
  console.error("❌ Invalid environment configuration:");
  console.error(parsedEnv.error.format());
  process.exit(1);
}

export const config = parsedEnv.success ? parsedEnv.data : process.env;

if (process.env.NODE_ENV === "production" && parsedEnv.success) {
  const wakeelApiHost = new URL(config.WAKEEL_API_BASE_URL).hostname;
  if (wakeelApiHost === "localhost" || wakeelApiHost === "127.0.0.1") {
    console.error(
      "❌ WAKEEL_API_BASE_URL cannot point to localhost in production.",
    );
    process.exit(1);
  }
}

export const llmConfig = {
  provider: config.LLM_PROVIDER || "iti",
  apiKey: config.LLM_API_KEY,
  modelName: config.LLM_MODEL,
  ...(config.LLM_BASE_URL && {
    baseURL: config.LLM_BASE_URL,
  }),
};
