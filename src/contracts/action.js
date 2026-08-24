import { z } from "zod";

export const ActionSchema = z.object({
  type: z.string(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Canonical action `type` values the clients (web + mobile) render.
 *
 * These are NOT new response shapes — every one of them is an ActionSchema
 * `{ type, payload }` carried in ChatResponse.actions. They are named here so
 * the tools, the orchestrator and the clients all agree on the exact strings.
 */
export const ACTION_TYPES = Object.freeze({
  /** A leave draft was created / submitted / cancelled. Existing type. */
  LEAVE_REQUEST: "leave_request",
  /**
   * The assistant needs an explicit yes before submitting a draft, because
   * submitting is not reversible by the employee.
   * payload: { request_id, leave_type?, start_date?, end_date?, days_requested? }
   */
  LEAVE_SUBMIT_CONFIRMATION: "leave_submit_confirmation",
  /**
   * More than one draft could be the one the user meant; the user must pick.
   * payload: { drafts: [{ request_id, leave_type?, start_date?, end_date?, days_requested? }] }
   */
  LEAVE_DRAFT_SELECTION: "leave_draft_selection",
});
