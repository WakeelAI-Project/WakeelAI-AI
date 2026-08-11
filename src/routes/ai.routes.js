import { Router } from "express";
import { z } from "zod";
import { validateRequest } from "../middleware/validate-request.js";
import { requireInternalAuth } from "../middleware/internal-auth.middleware.js";
import { postChat } from "../controllers/ai-chat.controller.js";
import { getHistory } from "../controllers/ai-history.controller.js";

const router = Router();

// Apply internal service authentication to all AI routes
router.use(requireInternalAuth);

// Define the route-specific validation schema for POST
const chatRequestSchema = z.object({
  message: z.string().trim().min(1, "Message cannot be empty").max(2000, "Message is too long"),
  conversationId: z.string().trim().min(1, "Conversation ID cannot be empty"),
});

// Define the route-specific validation schema for GET history
const historyQuerySchema = z.object({
  conversationId: z.string().trim().min(1, "Conversation ID cannot be empty"),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

// Register the POST /chat route with validation and controller
router.post(
  "/chat",
  validateRequest({ body: chatRequestSchema }),
  postChat
);

// Register the GET /history route
router.get(
  "/history",
  validateRequest({ query: historyQuerySchema }),
  getHistory
);

export default router;
