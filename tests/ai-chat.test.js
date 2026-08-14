import { jest } from "@jest/globals";

// We mock orchestrator.service.js because it now contains real LangChain/LLM logic
jest.unstable_mockModule("../src/orchestrator/orchestrator.service.js", () => ({
  handleChat: jest.fn().mockResolvedValue({
    conversationId: "conv-123",
    message: "Mocked AI response.",
    type: "text",
    sources: [],
    actions: []
  })
}));

// We mock chat-history.service.js so unit tests don't try to connect to MongoDB
jest.unstable_mockModule("../src/services/chat-history.service.js", () => ({
  persistUserMessage: jest.fn().mockResolvedValue(),
  persistAssistantMessage: jest.fn().mockResolvedValue(),
  getHistory: jest.fn().mockResolvedValue({}),
  getUserConversations: jest.fn().mockResolvedValue({})
}));

const request = (await import("supertest")).default;
const app = (await import("../src/app.js")).default;

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
      conversationId: "conv-123",
    },
  };

  const validHeaders = {
    "X-Internal-API-Key": "your_internal_api_key_here",
    "X-User-Id": "user-456",
    "X-Company-Id": "company-789",
    "X-Role": "employee",
  };

  beforeAll(() => {
    process.env.WAKEEL_INTERNAL_API_KEY = "your_internal_api_key_here";
  });

  it("returns 200 for a valid request with canonical context object", async () => {
    const expectedResponse = {
      conversationId: "conv-123",
      message: "Mocked AI response.",
      type: "text",
      sources: [],
      actions: []
    };

    const response = await request(app).post("/api/ai/chat").set(validHeaders).send(validPayload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expectedResponse);
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
      .set({ "X-Internal-API-Key": "your_internal_api_key_here" })
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
    "X-Internal-API-Key": "your_internal_api_key_here",
    "X-User-Id": "user-456",
    "X-Company-Id": "company-789",
    "X-Role": "employee",
  };

  it("returns 200 and the list of conversations", async () => {
    const expectedResponse = {
      conversations: [{ conversationId: "conv-1", role: "employee" }],
      pagination: { total: 1 }
    };
    const chatHistoryService = await import("../src/services/chat-history.service.js");
    chatHistoryService.getUserConversations.mockResolvedValue(expectedResponse);

    const response = await request(app).get("/api/ai/chat/conversations").set(validHeaders);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expectedResponse);
    expect(chatHistoryService.getUserConversations).toHaveBeenCalledWith(
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
      .set({ "X-Internal-API-Key": "your_internal_api_key_here" });
    expect(response.status).toBe(400);
  });
});
