/**
 * The final escalation taxonomy (spec §16.9) — the SINGLE source. Zod schemas, the database CHECK
 * constraint, dashboard labels and evals all mirror this list; a test asserts the migration matches.
 */
export const ESCALATION_REASONS = [
  "missing_required_field",
  "out_of_scope_lane",
  "out_of_scope_mode",
  "out_of_scope_container",
  "out_of_scope_service",
  "out_of_scope_cargo",
  "conflicting_cargo",
  "request_too_large",
  "rate_expired",
  "ambiguous_request",
  "tariff_config_error",
  "pricing_capacity_exceeded",
  "fx_invalid",
  "fx_missing_rate",
  "model_refused",
  "model_output_invalid",
  "low_confidence",
  "guard_violation",
] as const;

export type EscalationReason = (typeof ESCALATION_REASONS)[number];
