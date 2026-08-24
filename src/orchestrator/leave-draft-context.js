import { ACTION_TYPES } from "../contracts/action.js";

/**
 * Deterministic leave-draft resolution from conversation history.
 *
 * The LLM never sees a leave request id: normalizeConversationMessages() maps
 * history down to { role, content } and deliberately drops result_card, so
 * "ok send it" / "ابعتها" arrives at the tool with no request_id at all.
 * Rather than prompting the LLM harder, the id is resolved here, in code, from
 * the structured result_card / actions that chat-history already persists.
 */

export const SUBMIT_LEAVE_CAPABILITY = "submit_leave_draft";
export const CANCEL_LEAVE_CAPABILITY = "cancel_leave_draft";

const LEAVE_DRAFT_CAPABILITIES = new Set([
  SUBMIT_LEAVE_CAPABILITY,
  CANCEL_LEAVE_CAPABILITY,
]);

/**
 * Real request ids are backend GUIDs (Guid.NewGuid()), never a "req-" prefix.
 */
export const LEAVE_REQUEST_GUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * A draft result_card whose request_id later appears in an action with any of
 * these statuses is no longer a draft and must not be resolved again.
 */
const TERMINAL_LEAVE_STATUSES = new Set([
  "pending",
  "cancelled",
  "canceled",
  "approved",
  "rejected",
]);

const AFFIRMATIVE_PATTERNS = [
  // English
  /^(y|ya|yes|yeah|yep|yup|ok|okay|k|sure|please|confirm|confirmed|correct|right|absolutely|definitely|affirmative)\b/i,
  /\b(go ahead|do it|send it|submit it|cancel it|please do|that'?s right|sounds good|confirm(ed)?)\b/i,
  // Arabic
  /(^|\s)(نعم|أيوه|ايوه|ايوة|أيوة|اه|آه|أه|تمام|تمم|طيب|ماشي|حسنا|حسناً|أكيد|اكيد|موافق|موافقة|أكد|اكد|أرسلها|ارسلها|ابعتها|أبعتها|ابعثها|يلا|اوك|أوك|صح|صحيح)(\s|$|[.!،؟])/,
];

/**
 * True when the user's turn is an explicit affirmative ("yes", "نعم", ...).
 *
 * Only consulted when the assistant's previous turn asked a yes/no confirmation
 * question, so short words like "ok" cannot be misread outside that context.
 *
 * @param {string} text
 * @returns {boolean}
 */
export const isAffirmativeMessage = (text = "") => {
  const normalized = String(text).trim();
  if (!normalized) return false;

  // An explicit "no" always wins, even if an affirmative word follows it.
  if (/^(n|no|nope|nah|cancel that|don'?t|do not)\b/i.test(normalized)) {
    return false;
  }
  if (/(^|\s)(لا|لأ|مش|ليس|بلاش)(\s|$|[.!،؟])/.test(normalized)) {
    return false;
  }

  return AFFIRMATIVE_PATTERNS.some((pattern) => pattern.test(normalized));
};

/**
 * Extracts a backend GUID request id from free text.
 *
 * @param {string} text
 * @returns {string|null}
 */
export const extractRequestIdFromText = (text = "") => {
  const match = String(text).match(LEAVE_REQUEST_GUID_PATTERN);
  return match ? match[0] : null;
};

const asDraftSummary = (card) => ({
  request_id: card.request_id,
  leave_type: card.leave_type ?? null,
  start_date: card.start_date ?? null,
  end_date: card.end_date ?? null,
  days_requested:
    typeof card.days_requested === "number" ? card.days_requested : null,
});

const collectTerminalRequestIds = (conversationMessages = []) => {
  const terminal = new Set();

  for (const message of conversationMessages) {
    if (message?.role !== "assistant") continue;

    const actions = Array.isArray(message.actions) ? message.actions : [];
    for (const action of actions) {
      if (action?.type !== ACTION_TYPES.LEAVE_REQUEST) continue;

      const requestId = action?.payload?.request_id;
      const status = String(action?.payload?.status ?? "").toLowerCase();

      if (requestId && TERMINAL_LEAVE_STATUSES.has(status)) {
        terminal.add(requestId);
      }
    }
  }

  return terminal;
};

/**
 * Every leave draft still open in this conversation, NEWEST FIRST.
 *
 * A draft is "still open" when an assistant turn produced a leave_draft
 * result_card for it and no later assistant turn reported it as Pending /
 * Cancelled / Approved / Rejected.
 *
 * @param {Array<Object>} conversationMessages
 * @returns {Array<{request_id: string, leave_type: string|null, start_date: string|null, end_date: string|null, days_requested: number|null}>}
 */
export const findOpenLeaveDrafts = (conversationMessages = []) => {
  const messages = Array.isArray(conversationMessages)
    ? conversationMessages
    : [];
  const terminalIds = collectTerminalRequestIds(messages);
  const seen = new Set();
  const drafts = [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;

    const card = message.result_card;
    if (card?.type !== "leave_draft" || !card.request_id) continue;
    if (terminalIds.has(card.request_id) || seen.has(card.request_id)) continue;

    seen.add(card.request_id);
    drafts.push(asDraftSummary(card));
  }

  return drafts;
};

/**
 * The request id of the most recent still-open leave draft in this conversation.
 *
 * @param {Array<Object>} conversationMessages
 * @returns {string|null}
 */
export const resolveLatestDraftRequestId = (conversationMessages = []) => {
  const [latest] = findOpenLeaveDrafts(conversationMessages);
  return latest ? latest.request_id : null;
};

/**
 * The confirmation the assistant asked for on its most recent turn, if any.
 *
 * Only the LAST assistant turn counts — an older, already-answered confirmation
 * must never re-arm itself.
 *
 * @param {Array<Object>} conversationMessages
 * @returns {{capability: string, request_id: string, leave_type: string|null, start_date: string|null, end_date: string|null, days_requested: number|null}|null}
 */
export const findPendingLeaveConfirmation = (conversationMessages = []) => {
  const messages = Array.isArray(conversationMessages)
    ? conversationMessages
    : [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;

    const actions = Array.isArray(message.actions) ? message.actions : [];
    const confirmation = actions.find(
      (action) =>
        action?.type === ACTION_TYPES.LEAVE_SUBMIT_CONFIRMATION &&
        action?.payload?.request_id,
    );

    if (!confirmation) return null;

    return {
      capability: SUBMIT_LEAVE_CAPABILITY,
      ...asDraftSummary(confirmation.payload),
    };
  }

  return null;
};

/**
 * Resolves the request id (and the confirmation / disambiguation state) for a
 * submit_leave_draft or cancel_leave_draft capability before it executes.
 *
 * Resolution order:
 *   1. an explicit request_id argument
 *   2. an affirmative reply to the confirmation the assistant just asked for
 *   3. a GUID typed directly in the current message
 *   4. the single still-open draft in this conversation's history
 *   5. more than one open draft -> hand the candidates to the tool so it can
 *      ask the user which one they meant
 * When nothing resolves here the tool falls back to the backend's
 * GET /api/ai/leave-requests/latest-draft endpoint.
 *
 * @param {Object} input
 * @param {string} input.capability
 * @param {Object} [input.args]
 * @param {string} [input.message]
 * @param {Array<Object>} [input.conversationMessages]
 * @returns {Object} args, possibly enriched
 */
export const resolveLeaveDraftArgs = ({
  capability,
  args = {},
  message = "",
  conversationMessages = [],
}) => {
  if (!LEAVE_DRAFT_CAPABILITIES.has(capability)) return args;
  if (args.request_id) return args;

  const pending = findPendingLeaveConfirmation(conversationMessages);
  if (
    pending &&
    pending.capability === capability &&
    isAffirmativeMessage(message)
  ) {
    const { capability: _capability, ...details } = pending;
    return {
      ...args,
      request_id: pending.request_id,
      leave_draft_confirmed: true,
      leave_draft_details: details,
    };
  }

  const typedRequestId = extractRequestIdFromText(message);
  if (typedRequestId) {
    return { ...args, request_id: typedRequestId };
  }

  const openDrafts = findOpenLeaveDrafts(conversationMessages);

  if (openDrafts.length === 1) {
    return {
      ...args,
      request_id: openDrafts[0].request_id,
      leave_draft_details: openDrafts[0],
    };
  }

  if (openDrafts.length > 1) {
    return { ...args, leave_draft_candidates: openDrafts };
  }

  return args;
};

/**
 * Forces the submit capability when the user affirmatively answers the
 * confirmation question the assistant asked on the previous turn.
 *
 * Without this the intent LLM could classify a bare "yes" / "نعم" as
 * general_conversation and silently drop the confirmed submission.
 *
 * @param {string} message
 * @param {Object} intent
 * @param {Array<Object>} conversationMessages
 * @returns {Object}
 */
export const reinforceLeaveConfirmationIntent = (
  message,
  intent,
  conversationMessages = [],
) => {
  const pending = findPendingLeaveConfirmation(conversationMessages);

  if (!pending || !isAffirmativeMessage(message)) {
    return intent;
  }

  return {
    ...intent,
    intent: pending.capability,
    requiresCapabilities: [
      ...new Set([...(intent?.requiresCapabilities || []), pending.capability]),
    ],
  };
};
