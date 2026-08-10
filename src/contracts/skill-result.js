import { z } from "zod";
import { SourceSchema } from "./source.js";
import { ActionSchema } from "./action.js";

export const SkillResultSchema = z.object({
  success: z.boolean(),
  data: z.unknown().nullish(),
  message: z.string().nullish(),
  sources: z.array(SourceSchema).nullish(),
  action: ActionSchema.nullish(),
});
