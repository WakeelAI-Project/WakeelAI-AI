import mongoose from "mongoose";

const conversationSchema = new mongoose.Schema(
  {
    conversationId: {
      type: String,
      required: true,
      index: true,
      // Removed unique: true - uniqueness is now enforced by compound index
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    companyId: {
      type: String,
      required: true,
      index: true,
    },
    role: {
      type: String,
      required: true,
    },
    title: {
      type: String,
      default: null,
    },
    targetEmployeeId: {
      type: String,
      default: null,
    },
    targetEmployeeName: {
      type: String,
      default: null,
    },
  },
  {
    collection: "conversations",
    timestamps: true,
  }
);

// Compound unique index for owner-scoped conversations
// Same conversationId can exist for different users/companies
conversationSchema.index({ conversationId: 1, userId: 1, companyId: 1 }, { unique: true });

export const Conversation =
  mongoose.models.Conversation || mongoose.model("Conversation", conversationSchema);
