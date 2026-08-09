import { z } from "zod";

export const SourceSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  type: z.string().optional(),
  content: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
