import {
  enrichLeaveIntentWithDeterministicContext,
  extractLeaveArgumentsFromText,
} from "../src/orchestrator/leave-intent.js";
import { normalizeLeaveType } from "../src/domain/leave-types.js";

const baseDate = new Date(Date.UTC(2026, 7, 17));

describe("leave intent extraction", () => {
  it.each([
    [
      "Please create a sick leave request for me from August 20th to August 22nd.",
      "Sick",
    ],
    ["I need an annual leave from August 20th to August 22nd.", "Annual"],
    [
      "Please create an unpaid leave request from August 20th to August 22nd.",
      "Unpaid",
    ],
  ])("extracts natural-language leave type and date range from %s", (message, leaveType) => {
    expect(extractLeaveArgumentsFromText(message, baseDate)).toEqual({
      leave_type: leaveType,
      start_date: "2026-08-20",
      end_date: "2026-08-22",
    });
  });

  it("leaves leave_type missing when the user did not provide it", () => {
    expect(
      extractLeaveArgumentsFromText(
        "Please create a leave request from August 20th to August 22nd.",
        baseDate,
      ),
    ).toEqual({
      start_date: "2026-08-20",
      end_date: "2026-08-22",
    });
  });

  it.each(["Sick", "sick", "SICK", "SiCk"])(
    "normalizes case-insensitive Sick value %s",
    (value) => {
      expect(normalizeLeaveType(value)).toBe("Sick");
    },
  );

  it.each(["Annual", "annual", "ANNUAL", "AnNuAl"])(
    "normalizes case-insensitive Annual value %s",
    (value) => {
      expect(normalizeLeaveType(value)).toBe("Annual");
    },
  );

  it.each(["Unpaid", "unpaid", "UNPAID", "UnPaId"])(
    "normalizes case-insensitive Unpaid value %s",
    (value) => {
      expect(normalizeLeaveType(value)).toBe("Unpaid");
    },
  );

  it.each(["Sick", "sick"])(
    "fills a missing leave_type from a short follow-up answer: %s",
    (message) => {
      const intent = enrichLeaveIntentWithDeterministicContext(
        message,
        {
          intent: "general_conversation",
          requiresCapabilities: [],
          requiresContext: [],
          arguments: {},
        },
        [
          {
            role: "user",
            content: "Please create a leave request from August 20th to August 22nd.",
          },
          {
            role: "assistant",
            content: "I can help with that leave request, but I need a few required fields first.",
            missing_fields: [
              {
                field_name: "leave_type",
                input_type: "dropdown",
                label: "Leave Type",
                options: ["Annual", "Sick", "Unpaid"],
              },
            ],
          },
        ],
        baseDate,
      );

      expect(intent.intent).toBe("create_leave_draft");
      expect(intent.requiresCapabilities).toContain("create_leave_draft");
      expect(intent.arguments).toEqual({
        leave_type: "Sick",
        start_date: "2026-08-20",
        end_date: "2026-08-22",
      });
    },
  );

  it("does not carry a completed leave request's dates into a new one started right after it", () => {
    const intent = enrichLeaveIntentWithDeterministicContext(
      "so now I want make an annual request",
      {
        intent: "create_leave_draft",
        requiresCapabilities: ["create_leave_draft"],
        requiresContext: [],
        arguments: {},
      },
      [
        {
          role: "user",
          content: "I want to make a sick leave request",
        },
        {
          role: "assistant",
          content: "I can help with that leave request, but I need a few required fields first.",
          missing_fields: [
            { field_name: "start_date", input_type: "date", label: "Start Date", options: [] },
            { field_name: "end_date", input_type: "date", label: "End Date", options: [] },
          ],
        },
        {
          role: "user",
          content: "Start: 2026-10-25, End: 2026-10-26",
        },
        {
          role: "assistant",
          content: "I can help with that leave request, but I need a few required fields first.",
          missing_fields: [
            { field_name: "attachment_url", input_type: "file", label: "Medical Report", options: [] },
          ],
        },
        {
          role: "user",
          content: "[attached medical report]",
        },
        {
          role: "assistant",
          content: "I've created your sick leave draft.",
          missing_fields: [],
        },
      ],
      baseDate,
    );

    // The prior sick leave's dates must not bleed into this brand-new
    // annual request — they should be absent so the client is prompted
    // for fresh dates instead of silently reusing the old ones.
    expect(intent.arguments.start_date).toBeUndefined();
    expect(intent.arguments.end_date).toBeUndefined();
  });

  it("keeps the already-established leave type when a later reply's reason text contains a different type keyword", () => {
    // Regression: the missing-fields form submits its answers as one
    // synthesized message, e.g. "Providing requested details:\n...\nReason
    // / description (reason): sick at 10:50" — the word "sick" inside the
    // reason value must not overwrite the "Annual" type the user already
    // stated explicitly earlier in the same workflow.
    const intent = enrichLeaveIntentWithDeterministicContext(
      "Providing requested details:\nStart Date (start_date): 2026-11-29\nEnd Date (end_date): 2026-11-30\nReason / description (reason): sick at 10:50",
      {
        intent: "general_conversation",
        requiresCapabilities: [],
        requiresContext: [],
        arguments: {},
      },
      [
        {
          role: "user",
          content: "I want to make an annual request",
        },
        {
          role: "assistant",
          content: "I can help with that leave request, but I need a few required fields first.",
          missing_fields: [
            { field_name: "start_date", input_type: "date", label: "Start Date", options: [] },
            { field_name: "end_date", input_type: "date", label: "End Date", options: [] },
            { field_name: "reason", input_type: "text", label: "Reason / description", options: [] },
          ],
        },
      ],
      baseDate,
    );

    expect(intent.arguments.leave_type).toBe("Annual");
    expect(intent.arguments.start_date).toBe("2026-11-29");
    expect(intent.arguments.end_date).toBe("2026-11-30");
  });
});
