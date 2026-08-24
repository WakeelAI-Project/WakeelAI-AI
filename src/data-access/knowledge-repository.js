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
  const filter = scope === "company" && knowledgeType === "company-policy"
    ? { knowledgeType, scope, companyId: companyId ?? null }
    : buildDocumentFilter({
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

/**
 * Executes MongoDB Atlas Vector Search against the knowledge chunks collection.
 *
 * @param {Object} input
 * @param {string} input.indexName
 * @param {string} input.vectorPath
 * @param {Array<number>} input.queryVector
 * @param {Object} input.filter
 * @param {number} input.limit
 * @param {number} input.numCandidates
 * @returns {Promise<Array<Object>>}
 */
export const searchKnowledgeChunksByVector = async ({
  indexName,
  vectorPath,
  queryVector,
  filter,
  limit,
  numCandidates,
}) => {
  const pipeline = [
    {
      $vectorSearch: {
        index: indexName,
        path: vectorPath,
        queryVector,
        numCandidates,
        limit,
        filter,
      },
    },
    {
      $project: {
        _id: 0,
        documentId: 1,
        companyId: 1,
        knowledgeType: 1,
        scope: 1,
        title: 1,
        content: 1,
        chunkIndex: 1,
        knowledgeVersion: 1,
        sourcePath: 1,
        metadata: 1,
        score: { $meta: "vectorSearchScore" },
      },
    },
  ];

  return KnowledgeChunk.aggregate(pipeline);
};

