import { KnowledgeChunk } from "../../data-access/knowledge-chunk.model.js";
import { getKnowledgeVectorSearchIndexDescription } from "./knowledge-vector-index.config.js";

/**
 * Creates the configured MongoDB Atlas Vector Search index for knowledge chunks.
 * This helper is intentionally not run automatically during app startup.
 *
 * @returns {Promise<string>}
 */
export const createKnowledgeVectorSearchIndex = async () => (
  KnowledgeChunk.createSearchIndex(getKnowledgeVectorSearchIndexDescription())
);

