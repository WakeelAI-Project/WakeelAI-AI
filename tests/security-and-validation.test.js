/**
 * Tests for:
 * 1. UUID validation on context.conversationId (z.string().uuid())
 * 2. Conversation ownership isolation (conversationId + userId + companyId)
 * 3. Role gates on document generation (HR_Manager only)
 * 4. Role gates on leave tools (Employee and HR_Manager only)
 */

import { jest } from "@jest/globals";

// ─── Mocks shared across all describe blocks ─────────────────────────────────

const mockHandleChat = jest.fn().mockResolvedValue({
  conversationId: "00000000-0000-0000-0000-000000000001",
  message: "Mocked AI response.",
  type: "text",
  sources: [],
  actions: [],
});

jest.unstable_mockModule("../src/orchestrator/orchestrator.service.js", () => ({
  handleChat: mockHandleChat,
}));

// The leave role-gate tests below execute the real tools. A non-gated role now
// falls through to the backend latest-draft lookup, so the outbound client is
// mocked to keep these tests offline.
jest.unstable_mockModule("../src/integrations/wakeel/wakeel-client.js", () => ({
  wakeelFetch: jest.fn().mockRejectedValue(
    Object.assign(new Error("no draft"), { status: 404 }),
  ),
}));

const mockEnsureConversation = jest.fn().mockResolvedValue();

jest.unstable_mockModule("../src/services/chat-history.service.js", () => ({
  ensureConversation: mockEnsureConversation,
  getRecentHistoryForContext: jest.fn().mockResolvedValue([]),
  persistUserMessage: jest.fn().mockResolvedValue(),
  persistAssistantMessage: jest.fn().mockResolvedValue(),
  getHistory: jest.fn().mockResolvedValue({}),
  getUserConversations: jest.fn().mockResolvedValue({}),
}));

const request = (await import("supertest")).default;
const app = (await import("../src/app.js")).default;
const { config } = await import("../src/config/env.js");

// Standard valid UUID v4
const VALID_UUID = "123e4567-e89b-12d3-a456-426614174000";

const baseHeaders = {
  "X-Internal-API-Key": config.WAKEEL_INTERNAL_API_KEY,
  "X-User-Id": "user-a",
  "X-Company-Id": "company-a",
  "X-Role": "Employee",
};

const basePayload = (conversationId) => ({
  message: "Hello",
  context: {
    userId: "user-a",
    companyId: "company-a",
    role: "Employee",
    conversationId,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. UUID VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

describe("UUID validation — context.conversationId", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Valid cases
  it("accepts a standard lowercase UUID v4", async () => {
    const res = await request(app)
      .post("/api/ai/chat")
      .set(baseHeaders)
      .send(basePayload("123e4567-e89b-12d3-a456-426614174000"));
    expect(res.status).toBe(200);
  });

  it("accepts an uppercase UUID", async () => {
    const res = await request(app)
      .post("/api/ai/chat")
      .set(baseHeaders)
      .send(basePayload("123E4567-E89B-12D3-A456-426614174000"));
    expect(res.status).toBe(200);
  });

  it("accepts a UUID with surrounding whitespace after trim", async () => {
    const res = await request(app)
      .post("/api/ai/chat")
      .set(baseHeaders)
      .send(basePayload("  123e4567-e89b-12d3-a456-426614174000  "));
    expect(res.status).toBe(200);
  });

  // Invalid cases
  it("rejects 36 consecutive hyphens (old regex would accept this)", async () => {
    const res = await request(app)
      .post("/api/ai/chat")
      .set(baseHeaders)
      .send(basePayload("------------------------------------"));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a random 36-character alphanumeric string (no hyphens in right places)", async () => {
    const res = await request(app)
      .post("/api/ai/chat")
      .set(baseHeaders)
      .send(basePayload("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a malformed UUID with wrong segment lengths", async () => {
    const res = await request(app)
      .post("/api/ai/chat")
      .set(baseHeaders)
      .send(basePayload("123e4567-e89b-12d3-a456-42661417")); // too short
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an empty string", async () => {
    const res = await request(app)
      .post("/api/ai/chat")
      .set(baseHeaders)
      .send(basePayload(""));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a missing conversationId field", async () => {
    const { conversationId: _id, ...contextWithoutId } = basePayload(VALID_UUID).context;
    const res = await request(app)
      .post("/api/ai/chat")
      .set(baseHeaders)
      .send({ message: "Hello", context: contextWithoutId });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. CONVERSATION OWNERSHIP — regression against old single-field scope
// ─────────────────────────────────────────────────────────────────────────────

describe("Conversation ownership — upsertConversation scope", () => {
  // This test validates the *repository* filter directly (unit test level)
  // to prove the three-field ownership scope is intact.

  it("uses conversationId + userId + companyId as the upsert filter", async () => {
    jest.clearAllMocks();

    const convId = VALID_UUID;
    await request(app)
      .post("/api/ai/chat")
      .set(baseHeaders)
      .send(basePayload(convId));

    // ensureConversation must be called with the full owner triple
    expect(mockEnsureConversation).toHaveBeenCalledWith(
      convId,
      expect.objectContaining({
        userId: "user-a",
        companyId: "company-a",
        conversationId: convId,
      })
    );
  });

  it("two different owners can independently use the same conversationId", async () => {
    // Simulate User A + Company A
    jest.clearAllMocks();

    const sharedConvId = VALID_UUID;

    // Owner A
    await request(app)
      .post("/api/ai/chat")
      .set({ ...baseHeaders, "X-User-Id": "user-a", "X-Company-Id": "company-a" })
      .send({
        message: "Hello from A",
        context: { userId: "user-a", companyId: "company-a", role: "Employee", conversationId: sharedConvId },
      });

    // Owner B — same conversationId, different owner
    await request(app)
      .post("/api/ai/chat")
      .set({ ...baseHeaders, "X-User-Id": "user-b", "X-Company-Id": "company-b" })
      .send({
        message: "Hello from B",
        context: { userId: "user-b", companyId: "company-b", role: "Employee", conversationId: sharedConvId },
      });

    // ensureConversation must have been called twice with different owner scopes
    const calls = mockEnsureConversation.mock.calls;
    expect(calls).toHaveLength(2);

    // First call: Owner A
    expect(calls[0][1]).toMatchObject({ userId: "user-a", companyId: "company-a" });
    // Second call: Owner B
    expect(calls[1][1]).toMatchObject({ userId: "user-b", companyId: "company-b" });

    // Both calls use the same conversationId — this is the multi-tenant scenario
    expect(calls[0][0]).toBe(sharedConvId);
    expect(calls[1][0]).toBe(sharedConvId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. ROLE GATE — document generation (HR_Manager only)
// ─────────────────────────────────────────────────────────────────────────────

describe("Role gate — document generation (HR_Manager only)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  let documentGenerationSkill;

  beforeAll(async () => {
    documentGenerationSkill = (await import("../src/skills/document-generation/document-generation.skill.js")).default;
  });

  const ownerContext = {
    userId: "owner-1",
    companyId: "company-1",
    role: "Owner",
    conversationId: VALID_UUID,
  };

  const employeeContext = {
    userId: "emp-1",
    companyId: "company-1",
    role: "Employee",
    conversationId: VALID_UUID,
  };

  const hrManagerContext = {
    userId: "hr-1",
    companyId: "company-1",
    role: "HR_Manager",
    conversationId: VALID_UUID,
  };

  it("returns 403 FORBIDDEN_DOCUMENT_GENERATION for Owner role", async () => {
    const result = await documentGenerationSkill.execute("Generate contract", ownerContext);
    expect(result.success).toBe(false);
    expect(result.data.error.code).toBe("FORBIDDEN_DOCUMENT_GENERATION");
    expect(result.data.error.status).toBe(403);
  });

  it("returns 403 FORBIDDEN_DOCUMENT_GENERATION for Employee role", async () => {
    const result = await documentGenerationSkill.execute("Generate contract", employeeContext);
    expect(result.success).toBe(false);
    expect(result.data.error.code).toBe("FORBIDDEN_DOCUMENT_GENERATION");
    expect(result.data.error.status).toBe(403);
  });

  it("does NOT gate HR_Manager (passes the role check and proceeds)", async () => {
    // HR_Manager should pass the gate; the skill will then try to call real services.
    // We just check it didn't return a 403 gate error.
    const result = await documentGenerationSkill.execute("Generate contract", hrManagerContext);
    // The gate should not produce FORBIDDEN_DOCUMENT_GENERATION for HR_Manager
    if (!result.success) {
      expect(result.data?.error?.code).not.toBe("FORBIDDEN_DOCUMENT_GENERATION");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. ROLE GATE — leave tools (Employee and HR_Manager only)
// ─────────────────────────────────────────────────────────────────────────────

describe("Role gate — leave tools (Employee and HR_Manager only)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  let createLeaveDraftTool;
  let submitLeaveDraftTool;
  let cancelLeaveDraftTool;

  beforeAll(async () => {
    createLeaveDraftTool = (await import("../src/tools/create-leave-draft.tool.js")).default;
    submitLeaveDraftTool = (await import("../src/tools/submit-leave-draft.tool.js")).default;
    cancelLeaveDraftTool = (await import("../src/tools/cancel-leave-draft.tool.js")).default;
  });

  const ownerContext = {
    userId: "owner-1",
    companyId: "company-1",
    role: "Owner",
    conversationId: VALID_UUID,
  };

  const employeeContext = {
    userId: "emp-1",
    companyId: "company-1",
    role: "Employee",
    conversationId: VALID_UUID,
  };

  const hrManagerContext = {
    userId: "hr-1",
    companyId: "company-1",
    role: "HR_Manager",
    conversationId: VALID_UUID,
  };

  describe("createLeaveDraftTool", () => {
    it("returns 403 FORBIDDEN_LEAVE_ACTION for Owner role", async () => {
      const result = await createLeaveDraftTool.execute("Create leave", ownerContext, {});
      expect(result.success).toBe(false);
      expect(result.data.error.code).toBe("FORBIDDEN_LEAVE_ACTION");
      expect(result.data.error.status).toBe(403);
    });

    it("does NOT gate Employee (passes the role check)", async () => {
      const result = await createLeaveDraftTool.execute("Create leave", employeeContext, {});
      // Should NOT return FORBIDDEN_LEAVE_ACTION
      if (!result.success && result.data?.error?.code) {
        expect(result.data.error.code).not.toBe("FORBIDDEN_LEAVE_ACTION");
      }
    });

    it("gates HR_Manager (leave actions restricted to Employee)", async () => {
      const result = await createLeaveDraftTool.execute("Create leave", hrManagerContext, {});
      expect(result.success).toBe(false);
      expect(result.data?.error?.code).toBe("FORBIDDEN_LEAVE_ACTION");
    });
  });

  describe("submitLeaveDraftTool", () => {
    it("returns 403 FORBIDDEN_LEAVE_ACTION for Owner role", async () => {
      const result = await submitLeaveDraftTool.execute("Submit leave", ownerContext, {});
      expect(result.success).toBe(false);
      expect(result.data.error.code).toBe("FORBIDDEN_LEAVE_ACTION");
      expect(result.data.error.status).toBe(403);
    });

    it("does NOT gate Employee", async () => {
      const result = await submitLeaveDraftTool.execute("Submit leave", employeeContext, {});
      if (!result.success && result.data?.error?.code) {
        expect(result.data.error.code).not.toBe("FORBIDDEN_LEAVE_ACTION");
      }
    });

    it("gates HR_Manager (leave actions restricted to Employee)", async () => {
      const result = await submitLeaveDraftTool.execute("Submit leave", hrManagerContext, {});
      expect(result.success).toBe(false);
      expect(result.data?.error?.code).toBe("FORBIDDEN_LEAVE_ACTION");
    });
  });

  describe("cancelLeaveDraftTool", () => {
    it("returns 403 FORBIDDEN_LEAVE_ACTION for Owner role", async () => {
      const result = await cancelLeaveDraftTool.execute("Cancel leave", ownerContext, {});
      expect(result.success).toBe(false);
      expect(result.data.error.code).toBe("FORBIDDEN_LEAVE_ACTION");
      expect(result.data.error.status).toBe(403);
    });

    it("does NOT gate Employee", async () => {
      const result = await cancelLeaveDraftTool.execute("Cancel leave", employeeContext, {});
      if (!result.success && result.data?.error?.code) {
        expect(result.data.error.code).not.toBe("FORBIDDEN_LEAVE_ACTION");
      }
    });

    it("gates HR_Manager (leave actions restricted to Employee)", async () => {
      const result = await cancelLeaveDraftTool.execute("Cancel leave", hrManagerContext, {});
      expect(result.success).toBe(false);
      expect(result.data?.error?.code).toBe("FORBIDDEN_LEAVE_ACTION");
    });
  });
});
