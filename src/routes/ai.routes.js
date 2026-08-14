import { Router } from "express";
import { z } from "zod";
import { validateRequest } from "../middleware/validate-request.js";
import { requireInternalAuth } from "../middleware/internal-auth.middleware.js";
import { postChat } from "../controllers/ai-chat.controller.js";
import { getHistory, getConversations } from "../controllers/ai-history.controller.js";

const router = Router();

// Apply internal service authentication to all AI routes
router.use(requireInternalAuth);

/**
 * Canonical API v8 chat request schema.
 *
 * Identity and conversation context must be nested inside `context`.
 * Root-level `conversationId` is NOT accepted — this was the old pre-v8 contract.
 *
 * Optional fields:
 *   - `language`: preferred response language (e.g. "AR", "EN"). .NET may forward
 *     this from the client request but it is not yet formally defined in the
 *     .NET → Node internal payload (API v8 Page 16). Accepted optionally so the
 *     Node service is ready when .NET forwards it.
 *   - `field_values`: form values collected from missing_fields prompts (e.g.
 *     attachment_url for sick leave). Not yet forwarded by .NET (API v8 ambiguity —
 *     see Required Backend Follow-up). Accepted optionally for forward-compatibility.
 */
const chatRequestSchema = z.object({
  message: z.string().trim().min(1, "Message cannot be empty").max(2000, "Message is too long"),
  context: z.object({
    userId: z.string().trim().min(1, "context.userId is required"),
    companyId: z.string().trim().min(1, "context.companyId is required"),
    role: z.string().trim().min(1, "context.role is required"),
    conversationId: z.string().trim().min(1, "context.conversationId is required"),
  }),
  language: z.string().trim().optional(),
  field_values: z.record(z.string(), z.unknown()).optional(),
});

// Define the route-specific validation schema for GET history
const historyQuerySchema = z.object({
  conversationId: z.string().trim().min(1, "Conversation ID cannot be empty"),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

// Register the POST /chat route with validation and controller
router.post(
  "/chat",
  validateRequest({ body: chatRequestSchema }),
  postChat
);

// Register the GET /chat/history route
router.get(
  "/chat/history",
  validateRequest({ query: historyQuerySchema }),
  getHistory
);

const conversationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

// Register the GET /chat/conversations route
router.get(
  "/chat/conversations",
  validateRequest({ query: conversationsQuerySchema }),
  getConversations
);

export default router;
