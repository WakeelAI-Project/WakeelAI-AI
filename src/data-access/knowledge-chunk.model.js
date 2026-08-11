import mongoose from "mongoose";

const knowledgeChunkSchema = new mongoose.Schema(
  {
    documentId: {
      type: String,
      required: true,
      index: true,
    },
    companyId: {
      type: String,
      default: null,
      index: true,
    },
    sourceType: {
      type: String,
      required: true,
      enum: ["labor-law", "company-policy"],
      index: true,
    },
    scope: {
      type: String,
      required: true,
      enum: ["global", "company"],
      index: true,
    },
    title: {
      type: String,
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    chunkIndex: {
      type: Number,
      required: true,
    },
    embedding: {
      type: [Number],
      required: true,
      default: undefined,
    },
    knowledgeVersion: {
      type: String,
      default: null,
      index: true,
    },
    sourcePath: {
      type: String,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    collection: "knowledge_chunks",
    timestamps: true,
  }
);

knowledgeChunkSchema.index({
  documentId: 1,
  sourceType: 1,
  scope: 1,
  companyId: 1,
  knowledgeVersion: 1,
});

export const KnowledgeChunk = mongoose.models.KnowledgeChunk
  || mongoose.model("KnowledgeChunk", knowledgeChunkSchema);

