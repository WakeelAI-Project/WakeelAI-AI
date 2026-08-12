import mongoose from "mongoose";

const conversationSchema = new mongoose.Schema(
  {
    conversationId: {
      type: String,
      required: true,
      index: true,
      unique: true,
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
  },
  {
    collection: "conversations",
    timestamps: true,
  }
);

// Compound index for ownership validation
conversationSchema.index({ conversationId: 1, userId: 1, companyId: 1 });

export const Conversation =
  mongoose.models.Conversation || mongoose.model("Conversation", conversationSchema);
