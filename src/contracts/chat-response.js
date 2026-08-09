import { z } from "zod";
import { SourceSchema } from "./source.js";
import { ActionSchema } from "./action.js";

export const ChatResponseSchema = z.object({
  conversationId: z.string(),
  message: z.string(),
  type: z.enum(["text", "action"]),
  sources: z.array(SourceSchema),
  actions: z.array(ActionSchema),
});
