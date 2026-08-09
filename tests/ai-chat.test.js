import request from "supertest";
import { jest } from "@jest/globals";
import app from "../src/app.js";
import * as orchestratorService from "../src/orchestrator/orchestrator.service.js";

// We do not mock orchestrator.service.js because it is currently just a stateless stub,
// and Jest ESM mocking is complex. We will just test against the real stub.

describe("POST /api/ai/chat", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const validPayload = {
    message: "How many leave days do I have left?",
    conversationId: "conv-123",
    context: {
      userId: "user-456",
      companyId: "company-789",
      role: "employee"
    }
  };

  it("should return 200 and successful response for a valid request", async () => {
    const expectedResponse = {
      conversationId: "conv-123",
      message: "AI orchestration is not implemented yet.",
      type: "text",
      sources: [],
      actions: []
    };

    const response = await request(app).post("/api/ai/chat").send(validPayload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expectedResponse);
  });

  it("should return 400 if message is missing", async () => {
    const payload = { ...validPayload, message: undefined };
    const response = await request(app).post("/api/ai/chat").send(payload);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 if conversationId is missing", async () => {
    const payload = { ...validPayload, conversationId: "" };
    const response = await request(app).post("/api/ai/chat").send(payload);

    expect(response.status).toBe(400);
  });

  it("should return 400 if context.userId is missing", async () => {
    const payload = { ...validPayload, context: { ...validPayload.context, userId: undefined } };
    const response = await request(app).post("/api/ai/chat").send(payload);

    expect(response.status).toBe(400);
  });

  it("should return 400 if context.companyId is missing", async () => {
    const payload = { ...validPayload, context: { ...validPayload.context, companyId: undefined } };
    const response = await request(app).post("/api/ai/chat").send(payload);

    expect(response.status).toBe(400);
  });

  it("should return 400 if context.role is missing", async () => {
    const payload = { ...validPayload, context: { ...validPayload.context, role: undefined } };
    const response = await request(app).post("/api/ai/chat").send(payload);

    expect(response.status).toBe(400);
  });

  it("should return 400 if context is missing entirely", async () => {
    const payload = { message: "Hello", conversationId: "123" };
    const response = await request(app).post("/api/ai/chat").send(payload);

    expect(response.status).toBe(400);
  });
});
