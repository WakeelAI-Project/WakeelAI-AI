/**
 * FIX-05 — deterministic leave-draft resolution.
 *
 * "ok send it" / "ابعتها" carries no request id, and the LLM never sees one
 * because normalizeConversationMessages() drops result_card. These tests cover
 * every resolution branch that replaces the old (never-matching) /req-.../ regex.
 */
import {
  LEAVE_REQUEST_GUID_PATTERN,
  extractRequestIdFromText,
  findOpenLeaveDrafts,
  findPendingLeaveConfirmation,
  isAffirmativeMessage,
  reinforceLeaveConfirmationIntent,
  resolveLatestDraftRequestId,
  resolveLeaveDraftArgs,
} from "../src/orchestrator/leave-draft-context.js";

const DRAFT_A = "6f1c2a34-5b6d-4e7f-8a90-b1c2d3e4f567";
const DRAFT_B = "11112222-3333-4444-5555-666677778888";

const userTurn = (content) => ({ role: "user", content });

const draftTurn = (requestId, overrides = {}) => ({
  role: "assistant",
  content: "I've created your annual leave draft.",
  missing_fields: [],
  actions: [
    { type: "leave_request", payload: { request_id: requestId, status: "Draft" } },
  ],
  result_card: {
    type: "leave_draft",
    request_id: requestId,
    leave_type: "Annual",
    start_date: "2030-09-01",
    end_date: "2030-09-03",
    days_requested: 3,
    attachment_uploaded: false,
    actions: [],
    ...overrides,
  },
});

const statusTurn = (requestId, status) => ({
  role: "assistant",
  content: `Status is now ${status}.`,
  missing_fields: [],
  actions: [
    { type: "leave_request", payload: { request_id: requestId, status } },
  ],
  result_card: null,
});

const confirmationTurn = (requestId) => ({
  role: "assistant",
  content: "Just to confirm — should I submit your annual leave request?",
  missing_fields: [],
  actions: [
    {
      type: "leave_submit_confirmation",
      payload: {
        request_id: requestId,
        leave_type: "Annual",
        start_date: "2030-09-01",
        end_date: "2030-09-03",
        days_requested: 3,
      },
    },
  ],
  result_card: null,
});

describe("GUID request id extraction", () => {
  it("matches a backend GUID, not the old req- prefix", () => {
    expect(LEAVE_REQUEST_GUID_PATTERN.test(DRAFT_A)).toBe(true);
    expect(extractRequestIdFromText(`please submit ${DRAFT_A} now`)).toBe(DRAFT_A);
    expect(extractRequestIdFromText("please submit req-123 now")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(extractRequestIdFromText(DRAFT_A.toUpperCase())).toBe(
      DRAFT_A.toUpperCase(),
    );
  });

  it("returns null when there is no id at all", () => {
    expect(extractRequestIdFromText("ok send it")).toBeNull();
  });
});

describe("findOpenLeaveDrafts / resolveLatestDraftRequestId", () => {
  it("returns the newest draft first", () => {
    const history = [
      userTurn("annual leave 2030-09-01 to 2030-09-03"),
      draftTurn(DRAFT_A),
      userTurn("another one"),
      draftTurn(DRAFT_B, { request_id: DRAFT_B, leave_type: "Unpaid" }),
    ];

    expect(findOpenLeaveDrafts(history).map((d) => d.request_id)).toEqual([
      DRAFT_B,
      DRAFT_A,
    ]);
    expect(resolveLatestDraftRequestId(history)).toBe(DRAFT_B);
  });

  it("carries the type and dates needed for the confirmation message", () => {
    expect(findOpenLeaveDrafts([draftTurn(DRAFT_A)])[0]).toEqual({
      request_id: DRAFT_A,
      leave_type: "Annual",
      start_date: "2030-09-01",
      end_date: "2030-09-03",
      days_requested: 3,
    });
  });

  it("excludes drafts that were already submitted or cancelled", () => {
    const history = [
      draftTurn(DRAFT_A),
      draftTurn(DRAFT_B, { request_id: DRAFT_B }),
      statusTurn(DRAFT_B, "Pending"),
    ];

    expect(findOpenLeaveDrafts(history).map((d) => d.request_id)).toEqual([DRAFT_A]);

    const allClosed = [...history, statusTurn(DRAFT_A, "Cancelled")];
    expect(findOpenLeaveDrafts(allClosed)).toEqual([]);
    expect(resolveLatestDraftRequestId(allClosed)).toBeNull();
  });

  it("ignores user turns and non-leave result cards", () => {
    const history = [
      userTurn(`my id is ${DRAFT_A}`),
      {
        role: "assistant",
        content: "Here is your certificate.",
        actions: [],
        result_card: { type: "document_draft", doc_id: "doc-1", doc_type: "cert" },
      },
    ];

    expect(resolveLatestDraftRequestId(history)).toBeNull();
  });

  it("tolerates empty or malformed history", () => {
    expect(findOpenLeaveDrafts()).toEqual([]);
    expect(findOpenLeaveDrafts(null)).toEqual([]);
    expect(resolveLatestDraftRequestId([{ role: "assistant" }])).toBeNull();
  });
});

describe("isAffirmativeMessage", () => {
  it.each([
    "yes",
    "Yes please",
    "ok",
    "okay",
    "sure",
    "confirm",
    "go ahead",
    "ok send it",
    "نعم",
    "ايوه",
    "تمام",
    "موافق",
    "ابعتها",
  ])("treats %p as affirmative", (message) => {
    expect(isAffirmativeMessage(message)).toBe(true);
  });

  it.each(["no", "no thanks", "nope", "don't", "لا", "لا شكرا", ""])(
    "treats %p as NOT affirmative",
    (message) => {
      expect(isAffirmativeMessage(message)).toBe(false);
    },
  );
});

describe("findPendingLeaveConfirmation", () => {
  it("reads the confirmation from the most recent assistant turn", () => {
    const pending = findPendingLeaveConfirmation([
      draftTurn(DRAFT_A),
      userTurn("send it"),
      confirmationTurn(DRAFT_A),
    ]);

    expect(pending).toEqual({
      capability: "submit_leave_draft",
      request_id: DRAFT_A,
      leave_type: "Annual",
      start_date: "2030-09-01",
      end_date: "2030-09-03",
      days_requested: 3,
    });
  });

  it("does not re-arm an older, already-answered confirmation", () => {
    const history = [
      confirmationTurn(DRAFT_A),
      userTurn("yes"),
      statusTurn(DRAFT_A, "Pending"),
    ];

    expect(findPendingLeaveConfirmation(history)).toBeNull();
  });
});

describe("resolveLeaveDraftArgs", () => {
  const call = (overrides) =>
    resolveLeaveDraftArgs({
      capability: "submit_leave_draft",
      args: {},
      message: "",
      conversationMessages: [],
      ...overrides,
    });

  it("leaves non-leave capabilities untouched", () => {
    const args = { some: "value" };
    expect(
      resolveLeaveDraftArgs({ capability: "calculation", args, message: "hi" }),
    ).toBe(args);
  });

  it("prefers an explicit request_id argument", () => {
    const result = call({
      args: { request_id: DRAFT_B },
      conversationMessages: [draftTurn(DRAFT_A)],
    });

    expect(result.request_id).toBe(DRAFT_B);
    expect(result.leave_draft_confirmed).toBeUndefined();
  });

  it("marks the turn confirmed when the user affirms a pending confirmation", () => {
    const result = call({
      message: "نعم",
      conversationMessages: [draftTurn(DRAFT_A), confirmationTurn(DRAFT_A)],
    });

    expect(result.request_id).toBe(DRAFT_A);
    expect(result.leave_draft_confirmed).toBe(true);
    expect(result.leave_draft_details.leave_type).toBe("Annual");
  });

  it("does NOT confirm when the user declines", () => {
    const result = call({
      message: "no, not yet",
      conversationMessages: [draftTurn(DRAFT_A), confirmationTurn(DRAFT_A)],
    });

    expect(result.leave_draft_confirmed).toBeUndefined();
  });

  it("uses a GUID typed in the message", () => {
    const result = call({ message: `cancel ${DRAFT_B}` });
    expect(result.request_id).toBe(DRAFT_B);
  });

  it("resolves the single open draft from history for a typed 'ok send it'", () => {
    const result = call({
      message: "ok send it",
      conversationMessages: [userTurn("annual leave"), draftTurn(DRAFT_A)],
    });

    expect(result.request_id).toBe(DRAFT_A);
    expect(result.leave_draft_confirmed).toBeUndefined();
  });

  it("resolves the same way for the Arabic phrasing", () => {
    const result = resolveLeaveDraftArgs({
      capability: "cancel_leave_draft",
      args: {},
      message: "الغي الطلب",
      conversationMessages: [draftTurn(DRAFT_A)],
    });

    expect(result.request_id).toBe(DRAFT_A);
  });

  it("hands over candidates instead of guessing when several drafts are open", () => {
    const result = call({
      message: "send it",
      conversationMessages: [
        draftTurn(DRAFT_A),
        draftTurn(DRAFT_B, { request_id: DRAFT_B, leave_type: "Unpaid" }),
      ],
    });

    expect(result.request_id).toBeUndefined();
    expect(result.leave_draft_candidates.map((d) => d.request_id)).toEqual([
      DRAFT_B,
      DRAFT_A,
    ]);
  });

  it("resolves nothing when history has no draft, leaving the backend fallback", () => {
    expect(call({ message: "submit it" })).toEqual({});
  });
});

describe("reinforceLeaveConfirmationIntent", () => {
  const baseIntent = {
    intent: "general_conversation",
    requiresCapabilities: [],
    requiresContext: [],
  };

  it("forces submit_leave_draft on an affirmative reply to the confirmation", () => {
    const result = reinforceLeaveConfirmationIntent("yes", baseIntent, [
      confirmationTurn(DRAFT_A),
    ]);

    expect(result.intent).toBe("submit_leave_draft");
    expect(result.requiresCapabilities).toContain("submit_leave_draft");
  });

  it("leaves the intent alone with no pending confirmation", () => {
    expect(reinforceLeaveConfirmationIntent("yes", baseIntent, [])).toBe(baseIntent);
  });

  it("leaves the intent alone when the user declines", () => {
    expect(
      reinforceLeaveConfirmationIntent("no", baseIntent, [confirmationTurn(DRAFT_A)]),
    ).toBe(baseIntent);
  });
});
