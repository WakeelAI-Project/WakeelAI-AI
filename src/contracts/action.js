import { z } from "zod";

export const ActionSchema = z.object({
  type: z.string(),
  payload: z.record(z.string(), z.unknown()).optional(),
});
