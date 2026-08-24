import { jest } from "@jest/globals";

jest.unstable_mockModule("../src/data-access/chat-history.repository.js", () => ({
  upsertConversation: jest.fn(),
  saveMessage: jest.fn(),
  findConversation: jest.fn(),
  getMessages: jest.fn(),
  getRecentMessages: jest.fn(),
  getConversations: jest.fn(),
  setConversationTitleIfNotExists: jest.fn()
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
      const contextWithFields = {
        ...context,
        field_values: {
          document_type: "Warning_Letter",
        },
      };
      repository.upsertConversation.mockResolvedValue({
        conversationId,
        userId: context.userId,
        companyId: context.companyId,
        role: context.role,
      });
      repository.saveMessage.mockResolvedValue({});

      await chatHistoryService.persistUserMessage(conversationId, contextWithFields, "Hello AI");

      expect(repository.upsertConversation).toHaveBeenCalledWith({
        conversationId,
        userId: context.userId,
        companyId: context.companyId,
        role: context.role,
      });

      expect(repository.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
        conversationId,
        userId: context.userId,
        companyId: context.companyId,
        role: "user",
        content: "Hello AI",
        field_values: {
          document_type: "Warning_Letter",
        },
      }));
    });
  });

  describe("ensureConversation", () => {
    it("throws 404 when the conversation belongs to a different user or company", async () => {
      repository.upsertConversation.mockResolvedValue({
        conversationId,
        userId: "other-user",
        companyId: context.companyId,
        role: context.role,
      });

      await expect(
        chatHistoryService.ensureConversation(conversationId, context)
      ).rejects.toMatchObject({
        status: 404,
        code: "CONVERSATION_NOT_FOUND",
      });
    });
  });

  describe("persistAssistantMessage", () => {
    it("should save assistant message", async () => {
      repository.saveMessage.mockResolvedValue({});
      const resultCard = {
        type: "document_draft",
        doc_id: "doc-1",
        doc_type: "Contract",
      };
      const missingFields = [{
        field_name: "employee_id",
        input_type: "text",
        label: "Employee ID",
        options: [],
      }];

      await chatHistoryService.persistAssistantMessage(conversationId, context, {
        message: "Hello Human",
        type: "text",
        sources: [],
        actions: [],
        missing_fields: missingFields,
        result_card: resultCard,
      });

      expect(repository.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
        conversationId,
        userId: context.userId,
        companyId: context.companyId,
        role: "assistant",
        content: "Hello Human",
        missing_fields: missingFields,
        result_card: resultCard,
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

      expect(repository.getMessages).toHaveBeenCalledWith(
        conversationId,
        context.userId,
        context.companyId,
        1,
        20
      );
      expect(result.conversationId).toBe(conversationId);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].missing_fields).toEqual([]);
      expect(result.messages[0].result_card).toBeNull();
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

  describe("getRecentHistoryForContext", () => {
    it("returns recent scoped messages for LLM context", async () => {
      repository.findConversation.mockResolvedValue({ conversationId });
      repository.getRecentMessages.mockResolvedValue([
        {
          role: "user",
          content: "Question",
          field_values: { document_type: "Contract" },
          missing_fields: [],
          result_card: null,
          createdAt: new Date("2030-01-01T00:00:00Z"),
        },
        {
          role: "assistant",
          content: "Answer",
          missing_fields: [],
          result_card: null,
          createdAt: new Date("2030-01-01T00:00:01Z"),
        },
      ]);

      const result = await chatHistoryService.getRecentHistoryForContext(conversationId, context, 12);

      expect(repository.getRecentMessages).toHaveBeenCalledWith(
        conversationId,
        context.userId,
        context.companyId,
        12
      );
      expect(result).toEqual([
        {
          role: "user",
          content: "Question",
          missing_fields: [],
          field_values: { document_type: "Contract" },
          // actions are surfaced so leave-draft ids can be resolved from history
          actions: [],
          result_card: null,
          createdAt: new Date("2030-01-01T00:00:00Z"),
        },
        {
          role: "assistant",
          content: "Answer",
          missing_fields: [],
          actions: [],
          field_values: null,
          result_card: null,
          createdAt: new Date("2030-01-01T00:00:01Z"),
        },
      ]);
    });

    it("returns an empty context when a new conversation has no persisted messages yet", async () => {
      repository.findConversation.mockResolvedValue(null);

      const result = await chatHistoryService.getRecentHistoryForContext(conversationId, context);

      expect(result).toEqual([]);
      expect(repository.getRecentMessages).not.toHaveBeenCalled();
    });
  });

  describe("getUserConversations", () => {
    it("should return formatted conversations and pagination", async () => {
      repository.getConversations.mockResolvedValue({
        conversations: [{
          conversationId: "conv-1",
          role: "employee",
          createdAt: new Date(),
          updatedAt: new Date(),
        }],
        total: 1
      });

      const result = await chatHistoryService.getUserConversations(context, 1, 20);

      expect(repository.getConversations).toHaveBeenCalledWith(context.userId, context.companyId, 1, 20);
      expect(result.conversations).toHaveLength(1);
      expect(result.conversations[0].conversationId).toBe("conv-1");
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.hasNextPage).toBe(false);
    });
  });
});
