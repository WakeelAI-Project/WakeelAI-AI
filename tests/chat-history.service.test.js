import { jest } from "@jest/globals";

jest.unstable_mockModule("../src/data-access/chat-history.repository.js", () => ({
  upsertConversation: jest.fn(),
  saveMessage: jest.fn(),
  findConversation: jest.fn(),
  getMessages: jest.fn()
}));

const chatHistoryService = await import("../src/services/chat-history.service.js");
const repository = await import("../src/data-access/chat-history.repository.js");

describe("ChatHistoryService", () => {
  const conversationId = "conv-123";
  const context = {
    userId: "user-123",
    companyId: "company-123",
    role: "employee",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("persistUserMessage", () => {
    it("should upsert conversation and save user message", async () => {
      repository.upsertConversation.mockResolvedValue({});
      repository.saveMessage.mockResolvedValue({});

      await chatHistoryService.persistUserMessage(conversationId, context, "Hello AI");

      expect(repository.upsertConversation).toHaveBeenCalledWith({
        conversationId,
        userId: context.userId,
        companyId: context.companyId,
        role: context.role,
      });

      expect(repository.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
        conversationId,
        role: "user",
        content: "Hello AI",
      }));
    });
  });

  describe("persistAssistantMessage", () => {
    it("should save assistant message", async () => {
      repository.saveMessage.mockResolvedValue({});

      await chatHistoryService.persistAssistantMessage(conversationId, {
        message: "Hello Human",
        type: "text",
        sources: [],
        actions: [],
      });

      expect(repository.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
        conversationId,
        role: "assistant",
        content: "Hello Human",
      }));
    });
  });

  describe("getHistory", () => {
    it("should return formatted messages and pagination", async () => {
      repository.findConversation.mockResolvedValue({ conversationId });
      repository.getMessages.mockResolvedValue({
        messages: [{
          messageId: "msg-1",
          role: "user",
          content: "Hi",
          createdAt: new Date(),
        }],
        total: 1
      });

      const result = await chatHistoryService.getHistory(conversationId, context, 1, 20);

      expect(result.conversationId).toBe(conversationId);
      expect(result.messages).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.hasNextPage).toBe(false);
    });

    it("should throw 404 if conversation is not found or unauthorized", async () => {
      repository.findConversation.mockResolvedValue(null);

      await expect(
        chatHistoryService.getHistory(conversationId, context, 1, 20)
      ).rejects.toThrow("Conversation not found");
      
      try {
        await chatHistoryService.getHistory(conversationId, context, 1, 20);
      } catch (err) {
        expect(err.status).toBe(404);
        expect(err.code).toBe("CONVERSATION_NOT_FOUND");
      }
    });
  });
});
