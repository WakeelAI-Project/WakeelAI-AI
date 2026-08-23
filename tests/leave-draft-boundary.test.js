/**
 * FIX-05 — the orchestrator boundary must inject the resolved draft id into the
 * leave tools' args, since the LLM never has one.
 */
import { jest } from "@jest/globals";
import { z } from "zod";

jest.unstable_mockModule("../src/integrations/wakeel/wakeel-client.js", () => ({
  wakeelFetch: jest.fn(),
}));

const { executeCapabilitiesBoundary } = await import(
  "../src/orchestrator/dependency-boundaries.js"
);
const toolRegistry = await import("../src/tools/registry.js");

const DRAFT_GUID = "6f1c2a34-5b6d-4e7f-8a90-b1c2d3e4f567";
const OTHER_GUID = "11112222-3333-4444-5555-666677778888";

const draftTurn = (requestId, leaveType = "Annual") => ({
  role: "assistant",
  content: "I've created your leave draft.",
  missing_fields: [],
  actions: [
    { type: "leave_request", payload: { request_id: requestId, status: "Draft" } },
  ],
  result_card: {
    type: "leave_draft",
    request_id: requestId,
    leave_type: leaveType,
    start_date: "2030-09-01",
    end_date: "2030-09-03",
    days_requested: 3,
    attachment_uploaded: false,
    actions: [],
  },
});

const buildContext = ({ capability, message, conversationMessages = [] }) => ({
  message,
  conversationId: "conv-1",
  userContext: {
    userId: "employee-1",
    companyId: "company-1",
    role: "Employee",
  },
  conversationMessages,
  intent: { intent: capability, requiresCapabilities: [capability], arguments: {} },
  gatheredData: {},
  capabilityResults: [],
});

describe("executeCapabilitiesBoundary — leave draft id injection", () => {
  let capturedArgs;

  beforeEach(() => {
    capturedArgs = null;
    // Replace the registered tools with spies so we observe the args they receive.
    toolRegistry.clear();
    const spyTool = (name, type) => ({
      name,
      description: "spy",
      inputSchema: z.object({}).passthrough(),
      execute: async (_message, _context, args) => {
        capturedArgs = args;
        return { success: true, data: { type }, message: "ok" };
      },
    });
    toolRegistry.register(spyTool("submit_leave_draft", "leave_request"));
    toolRegistry.register(spyTool("calculation_spy", "calculation"));
  });

  it("injects the id of the single open draft for a typed 'ok send it'", async () => {
    await executeCapabilitiesBoundary(
      ["submit_leave_draft"],
      buildContext({
        capability: "submit_leave_draft",
        message: "ok send it",
        conversationMessages: [draftTurn(DRAFT_GUID)],
      }),
    );

    expect(capturedArgs.request_id).toBe(DRAFT_GUID);
  });

  it("passes candidates through when more than one draft is open", async () => {
    await executeCapabilitiesBoundary(
      ["submit_leave_draft"],
      buildContext({
        capability: "submit_leave_draft",
        message: "send it",
        conversationMessages: [
          draftTurn(DRAFT_GUID),
          draftTurn(OTHER_GUID, "Unpaid"),
        ],
      }),
    );

    expect(capturedArgs.request_id).toBeUndefined();
    expect(capturedArgs.leave_draft_candidates).toHaveLength(2);
  });

  it("does not touch args for a non-leave capability", async () => {
    await executeCapabilitiesBoundary(
      ["calculation_spy"],
      buildContext({
        capability: "calculation_spy",
        message: "ok send it",
        conversationMessages: [draftTurn(DRAFT_GUID)],
      }),
    );

    expect(capturedArgs).toEqual({});
  });
});
