import path from "node:path";
import { readFile } from "node:fs/promises";
import { config } from "../../config/env.js";
import { isKnowledgeVersionIngested } from "../../data-access/knowledge-repository.js";
import { logger } from "../../shared/logger.js";
import { ingestKnowledgeDocument } from "./knowledge-ingestion.service.js";

const createBootstrapError = (message) => {
  const error = new Error(message);
  error.code = "KNOWLEDGE_BOOTSTRAP_FAILED";
  error.status = 500;
  return error;
};

const resolveSourcePath = (sourcePath) => (
  path.isAbsolute(sourcePath) ? sourcePath : path.resolve(process.cwd(), sourcePath)
);

export const bootstrapInitialLaborLawKnowledge = async () => {
  const documentId = config.INITIAL_LABOR_LAW_DOCUMENT_ID;
  const title = config.INITIAL_LABOR_LAW_TITLE;
  const knowledgeVersion = config.INITIAL_LABOR_LAW_VERSION;
  const configuredSourcePath = config.INITIAL_LABOR_LAW_SOURCE_PATH;

  if (!documentId || !title || !knowledgeVersion || !configuredSourcePath) {
    throw createBootstrapError(
      "Initial labor-law bootstrap configuration is incomplete."
    );
  }

  const alreadyIngested = await isKnowledgeVersionIngested({
    documentId,
    knowledgeType: "labor-law",
    scope: "global",
    companyId: null,
    knowledgeVersion,
  });

  if (alreadyIngested) {
    logger.info(
      `[KnowledgeBootstrap] Initial labor-law knowledge already ingested documentId=${documentId} knowledgeVersion=${knowledgeVersion}`
    );

    return {
      success: true,
      documentId,
      chunksCreated: 0,
      skipped: true,
    };
  }

  const sourcePath = resolveSourcePath(configuredSourcePath);
  let content;
  try {
    content = await readFile(sourcePath, "utf8");
  } catch (error) {
    throw createBootstrapError(
      `Unable to read initial labor-law source document: ${sourcePath}`
    );
  }

  if (!content.trim()) {
    throw createBootstrapError(
      `Initial labor-law source document is empty: ${sourcePath}`
    );
  }

  logger.info(
    `[KnowledgeBootstrap] Ingesting initial labor-law knowledge documentId=${documentId} knowledgeVersion=${knowledgeVersion} sourcePath=${sourcePath}`
  );

  return ingestKnowledgeDocument(
    {
      companyId: "global",
      knowledgeType: "labor-law",
      documentId,
      title,
      content,
      knowledgeVersion,
      sourcePath,
    },
    { replaceExisting: false }
  );
};
