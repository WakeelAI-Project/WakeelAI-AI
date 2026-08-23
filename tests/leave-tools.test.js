import { jest } from "@jest/globals";
// registry imported dynamically

const mockWakeelFetch = jest.fn();

jest.unstable_mockModule("../src/integrations/wakeel/wakeel-client.js", () => ({
  wakeelFetch: mockWakeelFetch,
}));

describe("Leave Request Tools Integration", () => {
  const aiContext = {
    userId: "employee-user-1",
    companyId: "company-1",
    role: "Employee",
    conversationId: "conv-1",
  };

  let createLeaveDraftTool;
  let submitLeaveDraftTool;
  let cancelLeaveDraftTool;
  let registry;

  beforeAll(async () => {
    registry = await import("../src/tools/registry.js");
    createLeaveDraftTool = (await import("../src/tools/create-leave-draft.tool.js")).default;
    submitLeaveDraftTool = (await import("../src/tools/submit-leave-draft.tool.js")).default;
    cancelLeaveDraftTool = (await import("../src/tools/cancel-leave-draft.tool.js")).default;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    registry.clear();
  });

  describe("Tool Registration", () => {
    it("registers all three leave operations successfully", () => {
      registry.register(createLeaveDraftTool);
      registry.register(submitLeaveDraftTool);
      registry.register(cancelLeaveDraftTool);

      expect(registry.has("create_leave_draft")).toBe(true);
      expect(registry.has("submit_leave_draft")).toBe(true);
      expect(registry.has("cancel_leave_draft")).toBe(true);
    });
  });

  describe("createLeaveDraftTool", () => {
    it("returns missing fields if required arguments are omitted", async () => {
      const result = await createLeaveDraftTool.execute("I need leave", aiContext, {
        leave_type: "Annual"
      });

      expect(result.success).toBe(true);
      expect(result.data.status).toBe("missing_fields");
      expect(result.data.missing_fields.length).toBeGreaterThan(0);
      expect(result.data.missing_fields.map(f => f.field_name)).toContain("start_date");
      expect(result.data.missing_fields.map(f => f.field_name)).toContain("end_date");
    });

    it("includes the optional reason field alongside the required missing fields", async () => {
      const result = await createLeaveDraftTool.execute("I need leave", aiContext, {
        leave_type: "Annual"
      });

      const reasonField = result.data.missing_fields.find(f => f.field_name === "reason");
      expect(reasonField).toBeDefined();
      expect(reasonField.required).toBe(false);

      const startDateField = result.data.missing_fields.find(f => f.field_name === "start_date");
      expect(startDateField.required).toBe(true);
    });

    it("does not re-request reason once the user has already provided it", async () => {
      const result = await createLeaveDraftTool.execute("I need leave", aiContext, {
        leave_type: "Annual",
        reason: "Family event",
      });

      expect(result.data.missing_fields.map(f => f.field_name)).not.toContain("reason");
    });

    it("rejects invalid dates or types", async () => {
      const result = await createLeaveDraftTool.execute("Submit sick leave", aiContext, {
        leave_type: "Invalid",
        start_date: "2030-08-10",
        end_date: "2030-08-12"
      });

      expect(result.success).toBe(false);
      expect(result.data.status).toBe("error");
      expect(result.data.error.code).toBe("LEAVE_TYPE_INVALID");
    });

    it("successfully creates a leave draft via the backend API", async () => {
      mockWakeelFetch.mockResolvedValueOnce({
        request_id: "req-create-1",
        status: "Draft",
        days_requested: 3,
      });

      const args = {
        leave_type: "Annual",
        start_date: "2030-08-10",
        end_date: "2030-08-12",
        reason: "Vacation",
      };

      const result = await createLeaveDraftTool.execute("Create annual leave", aiContext, args);

      if (!result.success) console.error("CREATE FAIL:", JSON.stringify(result, null, 2));
      expect(result.success).toBe(true);
      expect(result.data.status).toBe("draft_created");
      expect(result.data.leave_request.request_id).toBe("req-create-1");
      expect(result.data.leave_request.status).toBe("Draft");

      // Verify M2M call
      expect(mockWakeelFetch).toHaveBeenCalledWith(
        "POST",
        "/api/ai/leave-requests",
        aiContext,
        expect.objectContaining({
          leave_type: "Annual",
          start_date: "2030-08-10",
          end_date: "2030-08-12",
          reason: "Vacation",
        })
      );
    });

    it("normalizes case-insensitive leave_type values before calling the backend API", async () => {
      mockWakeelFetch.mockResolvedValueOnce({
        request_id: "req-create-lowercase",
        status: "Draft",
        days_requested: 3,
      });

      const result = await createLeaveDraftTool.execute("Create annual leave", aiContext, {
        leave_type: "aNnUaL",
        start_date: "2030-08-10",
        end_date: "2030-08-12",
      });

      expect(result.success).toBe(true);
      expect(mockWakeelFetch).toHaveBeenCalledWith(
        "POST",
        "/api/ai/leave-requests",
        aiContext,
        expect.objectContaining({
          leave_type: "Annual",
          start_date: "2030-08-10",
          end_date: "2030-08-12",
        })
      );
    });

    it("requests attachment_url missing field for sick leave if not provided", async () => {
      const args = {
        leave_type: "Sick",
        start_date: "2030-08-10",
        end_date: "2030-08-12",
      };

      const result = await createLeaveDraftTool.execute("Create sick leave", aiContext, args);
      expect(result.success).toBe(true);
      expect(result.data.status).toBe("missing_fields");
      expect(result.data.missing_fields.map(f => f.field_name)).toContain("attachment_url");
      expect(result.data.missing_fields.map(f => f.field_name)).toContain("reason");
    });

    it("creates a sick leave draft successfully when attachment_url is provided in field_values", async () => {
      mockWakeelFetch.mockResolvedValueOnce({
        request_id: "req-create-sick",
        status: "Draft",
        days_requested: 3,
      });

      const args = {
        leave_type: "Sick",
        start_date: "2030-08-10",
        end_date: "2030-08-12",
        attachment_url: "https://storage.example.com/medical_report.pdf"
      };

      const contextWithFieldValues = {
        ...aiContext,
        field_values: { attachment_url: "https://storage.example.com/medical_report.pdf" }
      };

      const result = await createLeaveDraftTool.execute("Create sick leave", contextWithFieldValues, args);

      expect(result.success).toBe(true);
      expect(result.data.status).toBe("draft_created");
      expect(result.data.leave_request.request_id).toBe("req-create-sick");

      expect(mockWakeelFetch).toHaveBeenCalledWith(
        "POST",
        "/api/ai/leave-requests",
        contextWithFieldValues,
        expect.objectContaining({
          leave_type: "Sick",
          start_date: "2030-08-10",
          end_date: "2030-08-12",
          attachment_url: "https://storage.example.com/medical_report.pdf",
        })
      );
    });
  });

  describe("submitLeaveDraftTool", () => {
    it("submits the draft via PATCH using M2M and structured arguments", async () => {
      mockWakeelFetch.mockResolvedValueOnce({
        request_id: "req-123",
        status: "Pending",
      });

      const args = { request_id: "req-123" };
      const result = await submitLeaveDraftTool.execute("Submit it", aiContext, args);

      if (!result.success) console.error("SUBMIT FAIL:", JSON.stringify(result, null, 2));
      expect(result.success).toBe(true);
      expect(result.data.status).toBe("submitted");
      expect(result.data.leave_request.request_id).toBe("req-123");

      expect(mockWakeelFetch).toHaveBeenCalledWith(
        "PATCH",
        "/api/ai/leave-requests/req-123/submit",
        aiContext
      );
    });

    it("falls back to parsing request_id from message if args are missing", async () => {
      mockWakeelFetch.mockResolvedValueOnce({
        request_id: "req-fallback",
        status: "Pending",
      });

      // Pass empty args, but provide the ID in the message
      const result = await submitLeaveDraftTool.execute("Submit req-fallback please", aiContext, {});

      expect(result.success).toBe(true);
      expect(mockWakeelFetch).toHaveBeenCalledWith(
        "PATCH",
        "/api/ai/leave-requests/req-fallback/submit",
        aiContext
      );
    });

    it("fails cleanly if request_id is not provided and cannot be parsed", async () => {
      const result = await submitLeaveDraftTool.execute("Submit the draft", aiContext, {});
      expect(result.success).toBe(false);
      expect(result.data.error.code).toBe("LEAVE_REQUEST_ID_REQUIRED");
      expect(mockWakeelFetch).not.toHaveBeenCalled();
    });
  });

  describe("cancelLeaveDraftTool", () => {
    it("cancels the draft via DELETE using M2M and structured arguments", async () => {
      mockWakeelFetch.mockResolvedValueOnce({}); // Empty success for delete

      const args = { request_id: "req-cancel-1" };
      const result = await cancelLeaveDraftTool.execute("Cancel my draft", aiContext, args);

      expect(result.success).toBe(true);
      expect(result.data.status).toBe("cancelled");
      expect(result.data.leave_request.request_id).toBe("req-cancel-1");

      expect(mockWakeelFetch).toHaveBeenCalledWith(
        "DELETE",
        "/api/ai/leave-requests/req-cancel-1",
        aiContext
      );
    });
  });
});
