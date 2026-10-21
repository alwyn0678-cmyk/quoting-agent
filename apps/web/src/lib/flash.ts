/**
 * Plain-language messages for reviewer actions that fail. The reviewer RPCs raise check_violation
 * (23514) when the request is no longer in a state the action applies to — usually because another
 * reviewer acted first — so that case reads as information, not an error. Anything else gets a short
 * "what failed, what to do" line. Raw database text is never shown (it can leak schema details).
 */

export type ReviewerAction = "approve" | "archive" | "unarchive" | "requeue";

const VERB: Record<ReviewerAction, string> = {
  approve: "approve",
  archive: "archive",
  unarchive: "restore",
  requeue: "re-run",
};

const STATE_CONFLICT_CODES = new Set(["23514", "P0001"]);

export function describeMutationError(action: ReviewerAction, error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && STATE_CONFLICT_CODES.has(code)) {
    return "This request has already been handled or changed — the list now shows its current state.";
  }
  return `Couldn't ${VERB[action]} this request. Please try again; if it keeps failing, check the worker logs.`;
}

/** Cookie carrying one flash message to the next render. Short-lived and httpOnly. */
export const FLASH_COOKIE = "qa_flash";
