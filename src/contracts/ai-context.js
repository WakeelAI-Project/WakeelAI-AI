import { z } from "zod";

export const AIContextSchema = z.object({
  userId: z.string(),
  companyId: z.string(),
  role: z.string(),
  conversationId: z.string(),
});
