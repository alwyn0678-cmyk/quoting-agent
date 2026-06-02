-- 0014 — extend the escalation-reason taxonomy with 'out_of_scope_container'.
-- The gate now escalates when a resolved (mode, lane) card does not price the requested container
-- type (gate.ts), mirroring priceQuote()'s UnpriceableRequestError("out_of_scope_container").
-- This keeps the DB CHECK in lock-step with schemas.ts escalationReasonSchema. Append-only;
-- idempotent (drop+recreate the named constraint).
alter table public.quote_requests
  drop constraint if exists quote_requests_reason_enum;
alter table public.quote_requests
  add constraint quote_requests_reason_enum
    check (escalation_reason is null or escalation_reason in
      ('missing_required_field','out_of_scope_lane','out_of_scope_mode','out_of_scope_container',
       'ambiguous_request','low_confidence','guard_violation'));
