import { jest } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import app from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/data-access/database.js";
import { config } from "../src/config/env.js";

const shouldRunIntegrationTests = process.env.RUN_INTEGRATION_TESTS === "true";

if (!shouldRunIntegrationTests) {
  describe.skip("Chat History Integration (set RUN_INTEGRATION_TESTS=true to run)", () => {
    it("is skipped by default", () => {});
  });
} else {
  describe("Chat History Integration", () => {
    beforeAll(async () => {
      await connectDatabase();
    });

    afterAll(async () => {
      await disconnectDatabase();
    });

  it("should persist and retrieve chat history securely", async () => {
    const conversationId = new mongoose.Types.ObjectId().toString();
    const headers = {
      "X-Wakeel-Internal-Key": config.INTERNAL_SERVICE_KEY,
      "X-Wakeel-User-Id": "user-tenant-a",
      "X-Wakeel-Company-Id": "tenant-a",
      "X-Wakeel-Role": "employee"
    };

    // 1. Post a chat message
    const postRes = await request(app)
      .post("/api/ai/chat")
      .set(headers)
      .send({
        conversationId,
        message: "Hello world!",
      });

    expect(postRes.status).toBe(200);

    // 2. Retrieve history with the same context
    const getRes = await request(app)
      .get(`/api/ai/chat/history?conversationId=${conversationId}`)
      .set(headers);

    expect(getRes.status).toBe(200);
    expect(getRes.body.conversationId).toBe(conversationId);
    expect(getRes.body.messages.length).toBeGreaterThanOrEqual(2); // user + assistant

    const userMessage = getRes.body.messages.find(m => m.role === "user");
    expect(userMessage.content).toBe("Hello world!");

    // 3. Attempt to retrieve history with a different tenant's context (tenant isolation)
    const unauthorizedHeaders = {
      "X-Wakeel-Internal-Key": config.INTERNAL_SERVICE_KEY,
      "X-Wakeel-User-Id": "user-tenant-b",
      "X-Wakeel-Company-Id": "tenant-b",
      "X-Wakeel-Role": "employee"
    };

    const unauthorizedRes = await request(app)
      .get(`/api/ai/chat/history?conversationId=${conversationId}`)
      .set(unauthorizedHeaders);

    expect(unauthorizedRes.status).toBe(404);
    expect(unauthorizedRes.body.error.code).toBe("CONVERSATION_NOT_FOUND");
  });
});
}
