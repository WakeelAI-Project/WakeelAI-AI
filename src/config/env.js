import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  PORT: z.string().transform((val) => parseInt(val, 10)).default("3000"),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  MONGODB_DB_NAME: z.string().min(1, "MONGODB_DB_NAME is required"),
  LLM_API_KEY: z.string().min(1, "LLM_API_KEY is required"),
  LLM_MODEL: z.string().min(1, "LLM_MODEL is required"),
  EMBEDDING_API_KEY: z.string().min(1, "EMBEDDING_API_KEY is required"),
  EMBEDDING_MODEL: z.string().min(1, "EMBEDDING_MODEL is required"),
  WAKEEL_API_BASE_URL: z.string().url("WAKEEL_API_BASE_URL must be a valid URL"),
  WAKEEL_INTERNAL_API_KEY: z.string().min(1, "WAKEEL_INTERNAL_API_KEY is required"),
  VECTOR_INDEX_NAME: z.string().min(1, "VECTOR_INDEX_NAME is required"),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error("❌ Invalid environment configuration:");
  console.error(parsedEnv.error.format());
  process.exit(1);
}

export const config = parsedEnv.data;
