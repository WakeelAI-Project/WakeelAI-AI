import { jest } from "@jest/globals";

const mockHandleChat = jest.fn().mockResolvedValue({
  conversationId: "123e4567-e89b-12d3-a456-426614174000",
  message: "Mocked AI response.",
  type: "text",
  sources: [],
  actions: []
});
const mockConversationMessages = [
  { role: "user", content: "What are the annual leave rules under Egyptian Labor Law?" },
  { role: "assistant", content: "**Annual Leave**\n\nEmployees get annual leave according to the law." },
];
const mockEnsureConversation = jest.fn().mockResolvedValue();
const mockGetRecentHistoryForContext = jest.fn().mockResolvedValue(mockConversationMessages);
const mockPersistUserMessage = jest.fn().mockResolvedValue();
const mockPersistAssistantMessage = jest.fn().mockResolvedValue();
const mockGetHistory = jest.fn().mockResolvedValue({});
const mockGetUserConversations = jest.fn().mockResolvedValue({});
const mockDeleteConversation = jest.fn().mockResolvedValue();

// We mock orchestrator.service.js because it now contains real LangChain/LLM logic
jest.unstable_mockModule("../src/orchestrator/orchestrator.service.js", () => ({
  handleChat: mockHandleChat
}));

// We mock chat-history.service.js so unit tests don't try to connect to MongoDB
jest.unstable_mockModule("../src/services/chat-history.service.js", () => ({
  ensureConversation: mockEnsureConversation,
  getRecentHistoryForContext: mockGetRecentHistoryForContext,
  persistUserMessage: mockPersistUserMessage,
  persistAssistantMessage: mockPersistAssistantMessage,
  getHistory: mockGetHistory,
  getUserConversations: mockGetUserConversations,
  deleteConversation: mockDeleteConversation
}));

const request = (await import("supertest")).default;
const app = (await import("../src/app.js")).default;
const { config } = await import("../src/config/env.js");

describe("POST /api/ai/chat", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * API v8 canonical body: identity is nested in context.
   * conversationId is context.conversationId, NOT root-level.
   */
  const validPayload = {
    message: "How many leave days do I have left?",
    context: {
      userId: "user-456",
      companyId: "company-789",
      role: "employee",
      conversationId: "123e4567-e89b-12d3-a456-426614174000",
    },
  };

  const validHeaders = {
    "X-Internal-API-Key": config.WAKEEL_INTERNAL_API_KEY,
    "X-User-Id": "user-456",
    "X-Company-Id": "company-789",
    "X-Role": "employee",
  };

  it("returns 200 for a valid request with canonical context object", async () => {
    const expectedResponse = {
      conversationId: "123e4567-e89b-12d3-a456-426614174000",
      message: "Mocked AI response.",
      type: "text",
      sources: [],
      actions: []
    };

    const response = await request(app).post("/api/ai/chat").set(validHeaders).send(validPayload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expectedResponse);
  });

  it("loads previous scoped history before orchestration and persists the current turn after", async () => {
    const response = await request(app).post("/api/ai/chat").set(validHeaders).send(validPayload);

    expect(response.status).toBe(200);
    expect(mockEnsureConversation).toHaveBeenCalledWith(
      "123e4567-e89b-12d3-a456-426614174000",
      expect.objectContaining({
        userId: "user-456",
        companyId: "company-789",
        conversationId: "123e4567-e89b-12d3-a456-426614174000",
      })
    );
    expect(mockGetRecentHistoryForContext).toHaveBeenCalledWith(
      "123e4567-e89b-12d3-a456-426614174000",
      expect.objectContaining({
        userId: "user-456",
        companyId: "company-789",
      })
    );
    expect(mockHandleChat).toHaveBeenCalledWith(expect.objectContaining({
      message: validPayload.message,
      conversationId: "123e4567-e89b-12d3-a456-426614174000",
      conversationMessages: mockConversationMessages,
    }));

    const historyLoadOrder = mockGetRecentHistoryForContext.mock.invocationCallOrder[0];
    const orchestrationOrder = mockHandleChat.mock.invocationCallOrder[0];
    const userPersistOrder = mockPersistUserMessage.mock.invocationCallOrder[0];
    const assistantPersistOrder = mockPersistAssistantMessage.mock.invocationCallOrder[0];

    expect(historyLoadOrder).toBeLessThan(orchestrationOrder);
    expect(orchestrationOrder).toBeLessThan(userPersistOrder);
    expect(userPersistOrder).toBeLessThan(assistantPersistOrder);
  });

  it("returns 400 if message is missing", async () => {
    const payload = { ...validPayload, message: undefined };
    const response = await request(app).post("/api/ai/chat").set(validHeaders).send(payload);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 if context object is missing", async () => {
    const { context: _context, ...payloadWithoutContext } = validPayload;
    const response = await request(app).post("/api/ai/chat").set(validHeaders).send(payloadWithoutContext);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 if context.conversationId is missing", async () => {
    const payload = {
      ...validPayload,
      context: { ...validPayload.context, conversationId: "" },
    };
    const response = await request(app).post("/api/ai/chat").set(validHeaders).send(payload);

    expect(response.status).toBe(400);
  });

  it("returns 400 if context.userId is missing", async () => {
    const payload = {
      ...validPayload,
      context: { ...validPayload.context, userId: "" },
    };
    const response = await request(app).post("/api/ai/chat").set(validHeaders).send(payload);

    expect(response.status).toBe(400);
  });

  it("returns 403 if context identity does not match M2M headers (spoofing attempt)", async () => {
    const spooferPayload = {
      ...validPayload,
      context: {
        ...validPayload.context,
        userId: "attacker-user-id",   // Does NOT match X-User-Id header
      },
    };

    const response = await request(app).post("/api/ai/chat").set(validHeaders).send(spooferPayload);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("IDENTITY_CONTEXT_MISMATCH");
  });

  it("returns 401 if internal API key is missing", async () => {
    const response = await request(app).post("/api/ai/chat").send(validPayload);
    expect(response.status).toBe(401);
  });

  it("returns 400 if M2M identity headers are missing", async () => {
    const response = await request(app)
      .post("/api/ai/chat")
      .set({ "X-Internal-API-Key": config.WAKEEL_INTERNAL_API_KEY })
      .send(validPayload);
    expect(response.status).toBe(400);
  });

  it("accepts optional language field in the request body", async () => {
    const payloadWithLang = { ...validPayload, language: "AR" };
    const response = await request(app).post("/api/ai/chat").set(validHeaders).send(payloadWithLang);

    expect(response.status).toBe(200);
  });

  it("accepts optional field_values in the request body", async () => {
    const payloadWithFieldValues = {
      ...validPayload,
      field_values: { attachment_url: "https://storage.example.com/file.pdf" },
    };
    const response = await request(app).post("/api/ai/chat").set(validHeaders).send(payloadWithFieldValues);

    expect(response.status).toBe(200);
  });
});

describe("GET /api/ai/chat/conversations", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const validHeaders = {
    "X-Internal-API-Key": config.WAKEEL_INTERNAL_API_KEY,
    "X-User-Id": "user-456",
    "X-Company-Id": "company-789",
    "X-Role": "employee",
  };

  it("returns 200 and the list of conversations", async () => {
    const expectedResponse = {
      conversations: [{ conversationId: "conv-1", role: "employee" }],
      pagination: { total: 1 }
    };
    mockGetUserConversations.mockResolvedValue(expectedResponse);

    const response = await request(app).get("/api/ai/chat/conversations").set(validHeaders);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expectedResponse);
    expect(mockGetUserConversations).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-456",
        companyId: "company-789"
      }),
      1,
      20
    );
  });

  it("returns 401 if internal API key is missing", async () => {
    const response = await request(app).get("/api/ai/chat/conversations");
    expect(response.status).toBe(401);
  });

  it("returns 400 if M2M identity headers are missing", async () => {
    const response = await request(app)
      .get("/api/ai/chat/conversations")
      .set({ "X-Internal-API-Key": config.WAKEEL_INTERNAL_API_KEY });
    expect(response.status).toBe(400);
  });
});

describe("GET /api/ai/chat/history", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const validHeaders = {
    "X-Internal-API-Key": config.WAKEEL_INTERNAL_API_KEY,
    "X-User-Id": "user-456",
    "X-Company-Id": "company-789",
    "X-Role": "employee",
  };

  it("returns 200 with the requested conversation's history", async () => {
    const expectedResponse = { conversationId: "conv-1", messages: [], pagination: { total: 0 } };
    mockGetHistory.mockResolvedValue(expectedResponse);

    const response = await request(app)
      .get("/api/ai/chat/history?conversationId=conv-1")
      .set(validHeaders);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expectedResponse);
  });

  it("returns 401 if internal API key is missing", async () => {
    const response = await request(app).get("/api/ai/chat/history?conversationId=conv-1");
    expect(response.status).toBe(401);
    expect(mockGetHistory).not.toHaveBeenCalled();
  });

  it("returns 400 if M2M identity headers are missing", async () => {
    const response = await request(app)
      .get("/api/ai/chat/history?conversationId=conv-1")
      .set({ "X-Internal-API-Key": config.WAKEEL_INTERNAL_API_KEY });
    expect(response.status).toBe(400);
    expect(mockGetHistory).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/ai/chat/conversations/:conversationId", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const validHeaders = {
    "X-Internal-API-Key": config.WAKEEL_INTERNAL_API_KEY,
    "X-User-Id": "user-456",
    "X-Company-Id": "company-789",
    "X-Role": "employee",
  };

  it("returns 200 and deletes the conversation", async () => {
    const response = await request(app)
      .delete("/api/ai/chat/conversations/conv-1")
      .set(validHeaders);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(mockDeleteConversation).toHaveBeenCalledWith(
      "conv-1",
      expect.objectContaining({ userId: "user-456", companyId: "company-789" })
    );
  });

  it("returns 401 if internal API key is missing", async () => {
    const response = await request(app).delete("/api/ai/chat/conversations/conv-1");
    expect(response.status).toBe(401);
    expect(mockDeleteConversation).not.toHaveBeenCalled();
  });

  it("returns 400 if M2M identity headers are missing", async () => {
    const response = await request(app)
      .delete("/api/ai/chat/conversations/conv-1")
      .set({ "X-Internal-API-Key": config.WAKEEL_INTERNAL_API_KEY });
    expect(response.status).toBe(400);
    expect(mockDeleteConversation).not.toHaveBeenCalled();
  });
});
