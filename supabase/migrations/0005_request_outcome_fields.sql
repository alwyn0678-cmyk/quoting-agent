-- 0005 — Phase 1C.5: surface the safe-state outcome. quote_requests gains the two fields the
-- reviewer UI must show (AC-8), mirroring AgentOutput (schemas.ts):
--   escalation_reason — WHY a request was not auto-quoted (the gate/guard reason).
--   injection_flag    — the model's quote-and-flag signal; a request can be a valid quote AND
--                        flagged (gate.ts: the policy is quote-and-flag, not escalate-on-injection),
--                        so this is intentionally independent of status.
-- The autonomous run (1C.2) will populate these; until then they are seeded by tests/evals.
-- Append-only; idempotent.

alter table public.quote_requests
  add column if not exists escalation_reason text,
  add column if not exists injection_flag    boolean not null default false;

-- A reason may be present ONLY on an escalated request — mirrors the AgentOutput invariant that a
-- 'quote' carries no escalation_reason (schemas.ts superRefine). injection_flag stays unconstrained.
alter table public.quote_requests
  drop constraint if exists quote_requests_reason_requires_escalated;
alter table public.quote_requests
  add constraint quote_requests_reason_requires_escalated
    check (escalation_reason is null or status = 'escalated');

-- Constrain the reason to the AgentOutput taxonomy (schemas.ts escalationReasonSchema).
alter table public.quote_requests
  drop constraint if exists quote_requests_reason_enum;
alter table public.quote_requests
  add constraint quote_requests_reason_enum
    check (escalation_reason is null or escalation_reason in
      ('missing_required_field','out_of_scope_lane','out_of_scope_mode',
       'ambiguous_request','low_confidence','guard_violation'));
