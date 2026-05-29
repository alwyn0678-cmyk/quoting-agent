-- AC-8 (integrity half) — the escalation_reason constraints added in 0005. Proves the DB itself
-- keeps the safe-state fields well-formed, so the reviewer UI can trust them:
--   (1) a reason on a NON-escalated request is rejected (reason ⟹ escalated);
--   (2) a valid reason on an escalated request is accepted;
--   (3) an out-of-taxonomy reason is rejected (enum check);
--   (4) injection_flag on a quote-able request is accepted (quote-and-flag is allowed).
-- Runs in a transaction that ROLLS BACK. Any wrong outcome raises (Management API => FAIL).

begin;

insert into public.tenants (id, name) values ('0d000000-0000-4000-8000-0000000000c1','Constraint Tenant');

do $$
begin
  -- (1) reason on a non-escalated request must be rejected
  begin
    insert into public.quote_requests (tenant_id, source, status, escalation_reason)
      values ('0d000000-0000-4000-8000-0000000000c1','sample','awaiting_review','out_of_scope_lane');
    raise exception 'AC-8 FAIL: accepted escalation_reason on a non-escalated request';
  exception when check_violation then null;  -- expected
  end;

  -- (2) valid reason on an escalated request must be accepted
  insert into public.quote_requests (tenant_id, source, status, escalation_reason)
    values ('0d000000-0000-4000-8000-0000000000c1','sample','escalated','out_of_scope_lane');

  -- (3) an out-of-taxonomy reason must be rejected
  begin
    insert into public.quote_requests (tenant_id, source, status, escalation_reason)
      values ('0d000000-0000-4000-8000-0000000000c1','sample','escalated','definitely_not_a_reason');
    raise exception 'AC-8 FAIL: accepted an out-of-taxonomy escalation_reason';
  exception when check_violation then null;  -- expected
  end;

  -- (4) quote-and-flag: a flagged but quote-able request (no reason) must be accepted
  insert into public.quote_requests (tenant_id, source, status, escalation_reason, injection_flag)
    values ('0d000000-0000-4000-8000-0000000000c1','sample','awaiting_review', null, true);
end $$;

rollback;

select 'AC-8 constraints PASS — reason only on escalated, reason within taxonomy, injection_flag allowed on a quote' as result;
