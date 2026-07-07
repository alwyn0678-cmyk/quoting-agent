/**
 * Shared display formatting — the single source of truth for money, timestamps, and escalation-reason
 * labels, so every view (inbox / quotations / archive) renders identical text for the same data.
 */

/** EUR amount with en-US thousands grouping, e.g. "EUR 3,520". */
export const eur = (n: number) => `EUR ${n.toLocaleString("en-US")}`;

/** ISO timestamp rendered in UTC with an explicit suffix, e.g. "01/06/2026, 16:00:01 UTC". */
export const utc = (iso: string) => `${new Date(iso).toLocaleString("en-GB", { timeZone: "UTC" })} UTC`;

/** Human-readable labels for the escalation reason codes the agent can persist. */
export const REASON_LABELS: Record<string, string> = {
  missing_required_field: "Missing a required field",
  out_of_scope_lane: "Lane not in the rate card",
  out_of_scope_mode: "Transport mode not priced yet",
  out_of_scope_container: "Container type not priced on this lane",
  ambiguous_request: "Ambiguous request",
  low_confidence: "Low extraction confidence",
  guard_violation: "Safety guard tripped — failed closed",
};

/** Label for an escalation reason; unknown codes fall back to the humanized code. */
export function reasonLabel(code: string): string {
  return REASON_LABELS[code] ?? code.replace(/_/g, " ");
}
