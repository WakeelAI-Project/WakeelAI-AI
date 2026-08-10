import { Router } from "express";
import { validateRequest } from "../middleware/validate-request.js";
import { postKnowledgeIngest } from "../controllers/knowledge.controller.js";
import { KnowledgeIngestionRequestSchema } from "../rag/ingestion/knowledge-ingestion.schema.js";

const router = Router();

router.post(
  "/ingest",
  validateRequest({ body: KnowledgeIngestionRequestSchema }),
  postKnowledgeIngest
);

export default router;

