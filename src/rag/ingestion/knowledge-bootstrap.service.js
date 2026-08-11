import path from "node:path";
import { config } from "../../config/env.js";
import { isKnowledgeVersionIngested } from "../../data-access/knowledge-repository.js";
import { logger } from "../../shared/logger.js";
import { ingestKnowledgeDocument } from "./knowledge-ingestion.service.js";
import { extractTextFromPdfFile } from "./pdf-text-extractor.js";

const createBootstrapError = (message) => {
  const error = new Error(message);
  error.code = "KNOWLEDGE_BOOTSTRAP_FAILED";
  error.status = 500;
  return error;
};

const resolveSourcePath = (sourcePath) => (
  path.isAbsolute(sourcePath) ? sourcePath : path.resolve(process.cwd(), sourcePath)
);

const isPdfSourcePath = (sourcePath) => (
  path.extname(sourcePath).toLowerCase() === ".pdf"
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
    sourceType: "labor-law",
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
  if (!isPdfSourcePath(sourcePath)) {
    const message = `Initial labor-law source document must be a PDF file: ${sourcePath}`;
    logger.error(`[KnowledgeBootstrap] ${message}`);
    throw createBootstrapError(message);
  }

  let content;
  try {
    content = await extractTextFromPdfFile(sourcePath);
  } catch (error) {
    const message = error.code === "ENOENT"
      ? `Initial labor-law PDF source document was not found: ${sourcePath}`
      : `Unable to read or extract text from initial labor-law PDF source document: ${sourcePath}`;

    logger.error(`[KnowledgeBootstrap] ${message}`);
    throw createBootstrapError(message);
  }

  if (!content.trim()) {
    const message = `Initial labor-law PDF contains no extractable text; OCR would be required for a scanned or image-only PDF: ${sourcePath}`;
    logger.error(`[KnowledgeBootstrap] ${message}`);
    throw createBootstrapError(
      message
    );
  }

  logger.info(
    `[KnowledgeBootstrap] Ingesting initial labor-law knowledge documentId=${documentId} knowledgeVersion=${knowledgeVersion} sourcePath=${sourcePath}`
  );

  return ingestKnowledgeDocument(
    {
      companyId: "global",
      sourceType: "labor-law",
      documentId,
      title,
      content,
      knowledgeVersion,
      sourcePath,
    },
    { replaceExisting: false }
  );
};
