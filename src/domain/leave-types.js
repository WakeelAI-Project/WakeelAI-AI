export const LEAVE_TYPES = Object.freeze(["Annual", "Sick", "Unpaid"]);

const LEAVE_TYPE_BY_NORMALIZED_VALUE = new Map(
  LEAVE_TYPES.map((leaveType) => [leaveType.toLowerCase(), leaveType]),
);

export function normalizeLeaveType(value) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim().toLowerCase();
  return LEAVE_TYPE_BY_NORMALIZED_VALUE.get(normalized);
}

export function isSupportedLeaveType(value) {
  return Boolean(normalizeLeaveType(value));
}
