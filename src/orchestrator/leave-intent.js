import { LEAVE_TYPES, normalizeLeaveType } from "../domain/leave-types.js";

const CREATE_LEAVE_CAPABILITY = "create_leave_draft";
const LEAVE_WORKFLOW_FIELDS = new Set(["leave_type", "start_date", "end_date", "attachment_url", "reason"]);
const MONTHS = new Map([
  ["january", 0],
  ["jan", 0],
  ["february", 1],
  ["feb", 1],
  ["march", 2],
  ["mar", 2],
  ["april", 3],
  ["apr", 3],
  ["may", 4],
  ["june", 5],
  ["jun", 5],
  ["july", 6],
  ["jul", 6],
  ["august", 7],
  ["aug", 7],
  ["september", 8],
  ["sep", 8],
  ["sept", 8],
  ["october", 9],
  ["oct", 9],
  ["november", 10],
  ["nov", 10],
  ["december", 11],
  ["dec", 11],
]);

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const hasValue = (value) => (
  value !== undefined &&
  value !== null &&
  String(value).trim().length > 0
);

const formatIsoDate = (date) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const createUtcDate = (year, monthIndex, day) => {
  const date = new Date(Date.UTC(year, monthIndex, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== monthIndex ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
};

export function extractLeaveType(text = "") {
  const normalized = String(text).toLowerCase();
  if (normalized.includes("sick") || normalized.includes("medical") || normalized.includes("ill")) {
    return "Sick";
  }
  if (normalized.includes("unpaid") || normalized.includes("without pay")) {
    return "Unpaid";
  }
  if (normalized.includes("annual") || normalized.includes("vacation") || normalized.includes("pto")) {
    return "Annual";
  }

  return undefined;
}

function inferYear(monthIndex, day, baseDate) {
  const currentYear = baseDate.getUTCFullYear();
  const candidate = createUtcDate(currentYear, monthIndex, day);

  if (!candidate) return currentYear;

  const currentMonth = baseDate.getUTCMonth();
  return monthIndex < currentMonth ? currentYear + 1 : currentYear;
}

export function extractLeaveDates(text = "", baseDate = new Date()) {
  const args = {};
  const matches = [];
  const isoPattern = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  const monthPattern = new RegExp(
    `\\b(${[...MONTHS.keys()].join("|")})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`,
    "gi",
  );

  for (const match of text.matchAll(isoPattern)) {
    const date = createUtcDate(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (date) matches.push({ index: match.index ?? 0, value: formatIsoDate(date) });
  }

  for (const match of text.matchAll(monthPattern)) {
    const monthIndex = MONTHS.get(match[1].toLowerCase());
    const day = Number(match[2]);
    const year = match[3] ? Number(match[3]) : inferYear(monthIndex, day, baseDate);
    const date = createUtcDate(year, monthIndex, day);
    if (date) matches.push({ index: match.index ?? 0, value: formatIsoDate(date) });
  }

  const ordered = matches
    .sort((left, right) => left.index - right.index)
    .map((match) => match.value);
  const uniqueDates = [...new Set(ordered)];

  if (uniqueDates[0]) args.start_date = uniqueDates[0];
  if (uniqueDates[1]) args.end_date = uniqueDates[1];
  if (uniqueDates[0] && !uniqueDates[1] && /\b(for|on)\b/i.test(text)) {
    args.end_date = uniqueDates[0];
  }

  return args;
}

export function extractLeaveArgumentsFromText(text = "", baseDate = new Date()) {
  return {
    ...extractLeaveDates(text, baseDate),
    ...(extractLeaveType(text) ? { leave_type: extractLeaveType(text) } : {}),
  };
}

function normalizeLeaveArguments(args = {}) {
  const normalized = { ...args };
  if (hasValue(normalized.leave_type)) {
    normalized.leave_type = normalizeLeaveType(normalized.leave_type) || normalized.leave_type;
  }
  return normalized;
}

function getActiveLeaveMissingFields(conversationMessages = []) {
  for (let index = conversationMessages.length - 1; index >= 0; index -= 1) {
    const message = conversationMessages[index];
    if (message?.role !== "assistant") continue;

    const missingFields = Array.isArray(message.missing_fields)
      ? message.missing_fields
      : [];
    const fieldNames = missingFields
      .map((field) => field?.field_name)
      .filter(Boolean);

    if (fieldNames.some((fieldName) => LEAVE_WORKFLOW_FIELDS.has(fieldName))) {
      return fieldNames;
    }

    if (missingFields.length > 0) {
      return [];
    }
  }

  return [];
}

function extractHistoryLeaveArguments(conversationMessages = [], baseDate = new Date()) {
  return conversationMessages
    .filter((message) => message?.role === "user")
    .reduce(
      (args, message) => ({
        ...args,
        ...extractLeaveArgumentsFromText(message.content, baseDate),
      }),
      {},
    );
}

export function enrichLeaveIntentWithDeterministicContext(
  message,
  intent,
  conversationMessages = [],
  baseDate = new Date(),
) {
  const normalizedIntent = {
    ...intent,
    arguments: normalizeLeaveArguments(intent?.arguments || {}),
  };

  const activeMissingFields = getActiveLeaveMissingFields(conversationMessages);
  const currentArgs = extractLeaveArgumentsFromText(message, baseDate);
  const hasActiveLeaveWorkflow = activeMissingFields.length > 0;
  const isCreateLeaveIntent =
    normalizedIntent.intent === CREATE_LEAVE_CAPABILITY ||
    normalizedIntent.requiresCapabilities?.includes(CREATE_LEAVE_CAPABILITY);

  if (!isCreateLeaveIntent && !(hasActiveLeaveWorkflow && Object.keys(currentArgs).length > 0)) {
    return normalizedIntent;
  }

  const historyArgs = hasActiveLeaveWorkflow
    ? extractHistoryLeaveArguments(conversationMessages, baseDate)
    : {};
  const mergedArguments = normalizeLeaveArguments({
    ...historyArgs,
    ...normalizedIntent.arguments,
    ...currentArgs,
  });

  // NEVER assume a leave type. If it was not explicitly detected, leave it
  // undefined so create-leave-draft asks the user which type they want.
  if (!hasValue(mergedArguments.leave_type)) {
    delete mergedArguments.leave_type;
  }

  const requiresCapabilities = [
    ...new Set([...(normalizedIntent.requiresCapabilities || []), CREATE_LEAVE_CAPABILITY]),
  ];

  return {
    ...normalizedIntent,
    intent: CREATE_LEAVE_CAPABILITY,
    requiresCapabilities,
    arguments: mergedArguments,
  };
}
