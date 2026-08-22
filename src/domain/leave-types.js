export const LEAVE_TYPES = Object.freeze(["Annual", "Sick", "Unpaid"]);

const LEAVE_TYPE_BY_NORMALIZED_VALUE = new Map(
  LEAVE_TYPES.map((leaveType) => [leaveType.toLowerCase(), leaveType]),
);

export function normalizeLeaveType(value) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized.includes("sick") || normalized.includes("medical") || normalized.includes("ill")) return "Sick";
  if (normalized.includes("unpaid") || normalized.includes("without pay")) return "Unpaid";
  if (normalized.includes("annual") || normalized.includes("vacation") || normalized.includes("pto")) return "Annual";
  
  return LEAVE_TYPE_BY_NORMALIZED_VALUE.get(normalized);
}

export function isSupportedLeaveType(value) {
  return Boolean(normalizeLeaveType(value));
}
