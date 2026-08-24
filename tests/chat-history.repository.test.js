import { jest } from "@jest/globals";

const mockFindOneAndUpdate = jest.fn();

jest.unstable_mockModule("../src/data-access/conversation.model.js", () => ({
  Conversation: { findOneAndUpdate: mockFindOneAndUpdate },
}));

jest.unstable_mockModule("../src/data-access/message.model.js", () => ({
  Message: {},
}));

const { upsertConversation } = await import("../src/data-access/chat-history.repository.js");

describe("upsertConversation (FIX-18)", () => {
  const base = { conversationId: "conv-1", userId: "u1", companyId: "c1", role: "HR_Manager" };

  beforeEach(() => {
    jest.clearAllMocks();
    mockFindOneAndUpdate.mockResolvedValue({ ...base, targetEmployeeId: null, targetEmployeeName: null });
  });

  it("keeps core identity fields under $setOnInsert only", async () => {
    await upsertConversation({ ...base });

    const [, update] = mockFindOneAndUpdate.mock.calls[0];
    expect(update.$setOnInsert).toEqual(base);
  });

  it("puts a supplied target under $set, not $setOnInsert, so an existing conversation can be re-targeted", async () => {
    await upsertConversation({ ...base, targetEmployeeId: "emp-b", targetEmployeeName: "Employee B" });

    const [, update] = mockFindOneAndUpdate.mock.calls[0];
    expect(update.$set).toEqual({ targetEmployeeId: "emp-b", targetEmployeeName: "Employee B" });
    expect(update.$setOnInsert).not.toHaveProperty("targetEmployeeId");
    expect(update.$setOnInsert).not.toHaveProperty("targetEmployeeName");
  });

  it("omits $set entirely when no target is supplied, so an existing target is never overwritten with null", async () => {
    await upsertConversation({ ...base, targetEmployeeId: null, targetEmployeeName: null });

    const [, update] = mockFindOneAndUpdate.mock.calls[0];
    expect(update.$set).toBeUndefined();
  });

  it("uses findOneAndUpdate with upsert and returns the post-update document", async () => {
    mockFindOneAndUpdate.mockResolvedValue({ ...base, targetEmployeeId: "emp-b", targetEmployeeName: "Employee B" });

    const result = await upsertConversation({ ...base, targetEmployeeId: "emp-b", targetEmployeeName: "Employee B" });

    const [filter, , options] = mockFindOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ conversationId: "conv-1", userId: "u1", companyId: "c1" });
    expect(options).toMatchObject({ upsert: true, returnDocument: "after" });
    expect(result.targetEmployeeId).toBe("emp-b");
  });
});
