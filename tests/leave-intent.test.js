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
});
