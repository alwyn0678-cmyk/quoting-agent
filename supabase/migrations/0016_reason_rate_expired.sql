-- 0016 — extend the escalation-reason taxonomy with 'rate_expired'.
-- The gate (gate.ts) now refuses to quote from a rate card whose validity_through is before the
-- as-of date. Keeps the DB CHECK in lock-step with schemas.ts escalationReasonSchema, otherwise
-- persist_run_outcome would reject the escalation. Append-only; idempotent (drop + recreate).
alter table public.quote_requests
  drop constraint if exists quote_requests_reason_enum;
alter table public.quote_requests
  add constraint quote_requests_reason_enum
    check (escalation_reason is null or escalation_reason in
      ('missing_required_field','out_of_scope_lane','out_of_scope_mode','out_of_scope_container',
       'rate_expired','ambiguous_request','low_confidence','guard_violation'));
