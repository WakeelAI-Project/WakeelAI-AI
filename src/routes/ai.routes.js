import { Router } from "express";
import { z } from "zod";
import { validateRequest } from "../middleware/validate-request.js";
import { postChat } from "../controllers/ai-chat.controller.js";
import { AIContextSchema } from "../contracts/index.js";

const router = Router();

// Define the route-specific validation schema
const chatRequestSchema = z.object({
  message: z.string().trim().min(1, "Message cannot be empty").max(2000, "Message is too long"),
  conversationId: z.string().trim().min(1, "Conversation ID cannot be empty"),
  context: AIContextSchema.omit({ conversationId: true })
});

// Register the POST /chat route with validation and controller
router.post(
  "/chat",
  validateRequest({ body: chatRequestSchema }),
  postChat
);

export default router;
