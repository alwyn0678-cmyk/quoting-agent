-- AC-6 + P-APPROVE-AUTH — the approve → simulated-send gate (proving test for 1C.4).
-- Seeds two tenants/users, each with an awaiting_review request + draft, then, as an `authenticated`
-- caller (role + request.jwt.claims, like ac5), proves:
--   AC-6 negative — a direct UPDATE of quote_requests.status by authenticated is DENIED (no DML
--                   grant after 0003), so 'sent' is unreachable except through approve_request().
--   AC-6 positive — approve_request() on the caller's OWN awaiting_review request sets status='sent'
--                   AND stamps drafts.simulated_sent_at (the simulated send; no Graph send — AC-7).
--   P-APPROVE-AUTH — approve_request() on ANOTHER tenant's request is REFUSED, and that request's
--                    status + simulated_sent_at are left unchanged.
-- Runs in a transaction that ROLLS BACK (repeatable, leaves no rows). Any failure raises (the
-- Management API surfaces it as an error = FAIL); a clean run returns PASS.

begin;

insert into public.tenants (id, name) values
  ('0a000000-0000-4000-8000-0000000000a1','Approve Tenant A'),
  ('0b000000-0000-4000-8000-0000000000b1','Approve Tenant B');

insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','1a000000-0000-4000-8000-0000000000a1','authenticated','authenticated','apv-a@test.local', now(), now()),
  ('00000000-0000-0000-0000-000000000000','1b000000-0000-4000-8000-0000000000b1','authenticated','authenticated','apv-b@test.local', now(), now());

insert into public.profiles (user_id, tenant_id) values
  ('1a000000-0000-4000-8000-0000000000a1','0a000000-0000-4000-8000-0000000000a1'),
  ('1b000000-0000-4000-8000-0000000000b1','0b000000-0000-4000-8000-0000000000b1');

insert into public.quote_requests (id, tenant_id, source, status) values
  ('0c000000-0000-4000-8000-0000000000a1','0a000000-0000-4000-8000-0000000000a1','sample','awaiting_review'),
  ('0c000000-0000-4000-8000-0000000000b1','0b000000-0000-4000-8000-0000000000b1','sample','awaiting_review');

insert into public.drafts (request_id, tenant_id, subject, body) values
  ('0c000000-0000-4000-8000-0000000000a1','0a000000-0000-4000-8000-0000000000a1','Re','draft A'),
  ('0c000000-0000-4000-8000-0000000000b1','0b000000-0000-4000-8000-0000000000b1','Re','draft B');

-- Trigger (0006): the privileged session role bypasses RLS and holds DML, yet a DIRECT update to
-- 'sent' must STILL be blocked — only approve_request() (which sets a one-shot flag) may set it.
do $$
begin
  begin
    update public.quote_requests set status = 'sent' where id = '0c000000-0000-4000-8000-0000000000a1';
    raise exception 'AC-6 FAIL: privileged direct UPDATE to sent succeeded (enforce-sent trigger missing)';
  exception when check_violation then null;  -- expected: the trigger blocks it
  end;
end $$;

-- ── caller = user A (tenant A) ──
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1a000000-0000-4000-8000-0000000000a1"}', true);

do $$
declare
  v_status text;
  v_ts     timestamptz;
begin
  -- AC-6 negative: authenticated has no UPDATE grant → status cannot be moved outside the RPCs
  begin
    update public.quote_requests set status = 'sent' where id = '0c000000-0000-4000-8000-0000000000a1';
    raise exception 'AC-6 FAIL: authenticated UPDATED quote_requests.status directly (approve bypassed)';
  exception when insufficient_privilege then null;  -- expected: permission denied
  end;

  -- D-27 outbox: approve CLAIMS A's own request for send — awaiting_review → 'sending' (NOT 'sent';
  -- the trusted worker finalizes). approve must NOT stamp a real send.
  perform public.approve_request('0c000000-0000-4000-8000-0000000000a1');

  select status into v_status from public.quote_requests where id = '0c000000-0000-4000-8000-0000000000a1';
  if v_status is distinct from 'sending' then
    raise exception 'AC-6 FAIL: after approve, reqA.status = % (expected sending)', v_status;
  end if;
  select sent_at into v_ts from public.drafts where request_id = '0c000000-0000-4000-8000-0000000000a1';
  if v_ts is not null then
    raise exception 'AC-6 FAIL: approve stamped drafts.sent_at (must be set only by finalize_send)';
  end if;

  -- P-APPROVE-AUTH: A cannot approve tenant B's request
  begin
    perform public.approve_request('0c000000-0000-4000-8000-0000000000b1');
    raise exception 'P-APPROVE-AUTH FAIL: tenant A approved a tenant B request';
  exception when check_violation then null;  -- expected: refused by the RPC's tenant/state check
  end;

  -- finalize_send is service_role-only: an authenticated reviewer CANNOT forge a real send.
  begin
    perform public.finalize_send('0c000000-0000-4000-8000-0000000000a1','0a000000-0000-4000-8000-0000000000a1', true);
    raise exception 'AC-6 FAIL: authenticated could call finalize_send (real-send record is forgeable)';
  exception when insufficient_privilege then null;  -- expected: EXECUTE granted to service_role only
  end;
end $$;
reset role;

-- ── trusted finalize (service_role-only) completes the send for A: 'sending' → 'sent' + real sent_at ──
do $$
declare
  v_status text;
  v_ts     timestamptz;
begin
  perform public.finalize_send('0c000000-0000-4000-8000-0000000000a1','0a000000-0000-4000-8000-0000000000a1', true);
  select status into v_status from public.quote_requests where id = '0c000000-0000-4000-8000-0000000000a1';
  if v_status is distinct from 'sent' then
    raise exception 'AC-6 FAIL: after finalize_send, reqA.status = % (expected sent)', v_status;
  end if;
  select sent_at into v_ts from public.drafts where request_id = '0c000000-0000-4000-8000-0000000000a1';
  if v_ts is null then
    raise exception 'AC-6 FAIL: finalize_send did not stamp the real drafts.sent_at';
  end if;
end $$;

-- Verify tenant B is UNCHANGED (read as the migration role, which bypasses RLS).
do $$
declare
  v_status text;
  v_ts     timestamptz;
begin
  select status into v_status from public.quote_requests where id = '0c000000-0000-4000-8000-0000000000b1';
  if v_status is distinct from 'awaiting_review' then
    raise exception 'P-APPROVE-AUTH FAIL: tenant B request changed to % (expected awaiting_review)', v_status;
  end if;
  select sent_at into v_ts from public.drafts where request_id = '0c000000-0000-4000-8000-0000000000b1';
  if v_ts is not null then
    raise exception 'P-APPROVE-AUTH FAIL: tenant B draft was stamped sent_at';
  end if;
end $$;

rollback;

select 'AC-6 + P-APPROVE-AUTH PASS (D-27 outbox) — status unreachable outside the RPCs (privileged direct UPDATE blocked by trigger; authenticated direct UPDATE denied); approve CLAIMS own request to sending (no sent_at); authenticated CANNOT call finalize_send; service_role finalize_send -> sent + real drafts.sent_at; cross-tenant approve refused and B unchanged' as result;
