import { KnowledgeChunk } from "./knowledge-chunk.model.js";

const buildDocumentFilter = ({ documentId, knowledgeType, scope, companyId, knowledgeVersion }) => ({
  documentId,
  knowledgeType,
  scope,
  companyId: companyId ?? null,
  knowledgeVersion: knowledgeVersion ?? null,
});

/**
 * Replaces chunks for the same logical document. This keeps manual re-ingestion
 * predictable without introducing document versioning.
 *
 * @param {Object} input
 * @param {string} input.documentId
 * @param {string} input.knowledgeType
 * @param {string} input.scope
 * @param {string|null} input.companyId
 * @param {string|null} [input.knowledgeVersion]
 * @param {Array<Object>} input.chunks
 * @returns {Promise<Array<Object>>}
 */
export const replaceKnowledgeChunks = async ({
  documentId,
  knowledgeType,
  scope,
  companyId,
  knowledgeVersion,
  chunks,
}) => {
  const filter = buildDocumentFilter({
    documentId,
    knowledgeType,
    scope,
    companyId,
    knowledgeVersion,
  });

  await KnowledgeChunk.deleteMany(filter);
  return KnowledgeChunk.insertMany(chunks, { ordered: true });
};

/**
 * Inserts a new set of knowledge chunks without deleting existing versions.
 *
 * @param {Array<Object>} chunks
 * @returns {Promise<Array<Object>>}
 */
export const insertKnowledgeChunks = async (chunks) => (
  KnowledgeChunk.insertMany(chunks, { ordered: true })
);

/**
 * Checks whether a specific knowledge document version already exists.
 *
 * @param {Object} input
 * @param {string} input.documentId
 * @param {string} input.knowledgeType
 * @param {string} input.scope
 * @param {string|null} [input.companyId]
 * @param {string} input.knowledgeVersion
 * @returns {Promise<boolean>}
 */
export const isKnowledgeVersionIngested = async ({
  documentId,
  knowledgeType,
  scope,
  companyId = null,
  knowledgeVersion,
}) => {
  const existingCount = await KnowledgeChunk.countDocuments({
    documentId,
    knowledgeType,
    scope,
    companyId,
    knowledgeVersion,
  });

  return existingCount > 0;
};

