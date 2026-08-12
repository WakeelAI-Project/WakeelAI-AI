import { z } from "zod";

const baseKnowledgeIngestionSchema = z.object({
  companyId: z.string().trim().min(1, "Company ID cannot be empty"),
  sourceType: z.enum(["labor-law", "company-policy"]),
  documentId: z.string().trim().min(1, "Document ID cannot be empty"),
  title: z.string().trim().min(1, "Title cannot be empty"),
  content: z.string().trim().min(1, "Content cannot be empty"),
});

export const KnowledgeIngestionRequestSchema = baseKnowledgeIngestionSchema.strict();

export const KnowledgeIngestionInputSchema = baseKnowledgeIngestionSchema.extend({
  knowledgeVersion: z.string().trim().min(1, "Knowledge version cannot be empty").optional(),
  sourcePath: z.string().trim().min(1, "Source path cannot be empty").optional(),
}).strict();

