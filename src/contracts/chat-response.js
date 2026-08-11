import { z } from "zod";
import { SourceSchema } from "./source.js";
import { ActionSchema } from "./action.js";

export const MissingFieldSchema = z.object({
  field_name: z.string(),
  input_type: z.enum(["text", "number", "dropdown", "date", "file"]),
  label: z.string(),
  options: z.array(z.string()).optional()
});

export const CalculationResultCardSchema = z.object({
  type: z.literal("calculation"),
  calculation_type: z.string(),
  inputs: z.record(z.unknown()),
  result: z.number(),
  currency: z.string().optional(),
  breakdown: z.array(z.unknown()).optional()
});

export const DocumentDraftResultCardSchema = z.object({
  type: z.literal("document_draft"),
  doc_id: z.string(),
  doc_type: z.string(),
  employee_id: z.string().optional(),
  employee_name: z.string().optional()
});

export const LeaveDraftResultCardSchema = z.object({
  type: z.literal("leave_draft"),
  request_id: z.string(),
  leave_type: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  days_requested: z.number(),
  attachment_uploaded: z.boolean(),
  actions: z.array(z.string())
});

export const ResultCardSchema = z.discriminatedUnion("type", [
  CalculationResultCardSchema,
  DocumentDraftResultCardSchema,
  LeaveDraftResultCardSchema
]);

export const ChatResponseSchema = z.object({
  conversationId: z.string(),
  message: z.string(),
  type: z.enum(["text", "action"]),
  sources: z.array(SourceSchema),
  actions: z.array(ActionSchema),
  missing_fields: z.array(MissingFieldSchema).optional(),
  result_card: ResultCardSchema.optional(),
});
