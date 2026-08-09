import { z } from "zod";
import { SourceSchema } from "./source.js";
import { ActionSchema } from "./action.js";

export const SkillResultSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  message: z.string().optional(),
  sources: z.array(SourceSchema).optional(),
  action: ActionSchema.optional(),
});
