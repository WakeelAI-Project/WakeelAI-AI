import { Router } from "express";
import { validateRequest } from "../middleware/validate-request.js";
import { requireInternalAuth } from "../middleware/internal-auth.middleware.js";
import { postKnowledgeIngest } from "../controllers/knowledge.controller.js";
import { KnowledgeIngestionRequestSchema } from "../rag/ingestion/knowledge-ingestion.schema.js";

const router = Router();

// This is an internal M2M endpoint (.NET -> AI Server) and must enforce the
// same internal service authentication as the /api/ai/* routes.
router.use(requireInternalAuth);

router.post(
  "/ingest",
  validateRequest({ body: KnowledgeIngestionRequestSchema }),
  postKnowledgeIngest
);

export default router;

