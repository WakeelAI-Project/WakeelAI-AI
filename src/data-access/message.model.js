import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    messageId: {
      type: String,
      required: true,
      index: true,
      unique: true,
    },
    conversationId: {
      type: String,
      required: true,
      index: true,
    },
    role: {
      type: String,
      required: true,
      enum: ["user", "assistant"],
    },
    content: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      default: "text",
    },
    sources: {
      type: Array,
      default: [],
    },
    actions: {
      type: Array,
      default: [],
    },
  },
  {
    collection: "messages",
    timestamps: true,
  }
);

// Compound index for efficient history retrieval and pagination
messageSchema.index({ conversationId: 1, createdAt: 1 });

export const Message =
  mongoose.models.Message || mongoose.model("Message", messageSchema);
