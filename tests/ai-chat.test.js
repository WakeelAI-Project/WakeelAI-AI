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
  getHistory: jest.fn().mockResolvedValue({})
}));

const request = (await import("supertest")).default;
const app = (await import("../src/app.js")).default;

describe("POST /api/ai/chat", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const validPayload = {
    message: "How many leave days do I have left?",
    conversationId: "conv-123"
  };

  const validHeaders = {
    "X-Internal-API-Key": "your_internal_api_key_here",
    "X-User-Id": "user-456",
    "X-Company-Id": "company-789",
    "X-Role": "employee"
  };

  beforeAll(() => {
    process.env.WAKEEL_INTERNAL_API_KEY = "your_internal_api_key_here";
  });

  it("should return 200 and successful response for a valid request", async () => {
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

  it("should return 400 if message is missing", async () => {
    const payload = { ...validPayload, message: undefined };
    const response = await request(app).post("/api/ai/chat").set(validHeaders).send(payload);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 if conversationId is missing", async () => {
    const payload = { ...validPayload, conversationId: "" };
    const response = await request(app).post("/api/ai/chat").set(validHeaders).send(payload);

    expect(response.status).toBe(400);
  });

  it("should return 401 if internal key is missing", async () => {
    const response = await request(app).post("/api/ai/chat").send(validPayload);
    expect(response.status).toBe(401);
  });

  it("should return 400 if identity headers are missing", async () => {
    const response = await request(app).post("/api/ai/chat").set({ "X-Internal-API-Key": "your_internal_api_key_here" }).send(validPayload);
    expect(response.status).toBe(400);
  });
});
