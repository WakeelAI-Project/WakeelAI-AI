import { ingestKnowledgeDocument } from "../rag/ingestion/knowledge-ingestion.service.js";

/**
 * Knowledge ingestion controller.
 * Receives validated HTTP input and delegates the ingestion workflow.
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
export const postKnowledgeIngest = async (req, res, next) => {
  try {
    const result = await ingestKnowledgeDocument(req.body);
    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

