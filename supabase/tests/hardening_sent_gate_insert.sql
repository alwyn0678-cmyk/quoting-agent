-- hardening: the 'sent' INSERT bypass (migration 0015 §4). 0006's enforce-sent trigger fired on
-- BEFORE UPDATE only, so a row INSERTED with status='sent' (any role holding INSERT — the privileged
-- session here stands in for service_role, which bypasses RLS) skipped the gate entirely. Proves:
--   negative — INSERT born-'sent' raises check_violation (the recreated BEFORE INSERT OR UPDATE
--              trigger blocks it outside the one-shot GUC window);
--   positive — ordinary inserts ('awaiting_review' seed) still pass, and the legitimate HITL path
--              (approve_request as authenticated → finalize_send as the trusted role, which sets
--              quoteagent.allow_sent around its UPDATE — 0011) still reaches 'sent' + real sent_at.
-- Runs in a txn that ROLLS BACK.

begin;

insert into public.tenants (id, name) values ('0f300000-0000-4000-8000-000000000001','Sent Gate Tenant');

insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','1f300000-0000-4000-8000-000000000001','authenticated','authenticated','sentgate@test.local', now(), now());
insert into public.profiles (user_id, tenant_id) values
  ('1f300000-0000-4000-8000-000000000001','0f300000-0000-4000-8000-000000000001');

-- positive (implicit): a normal non-'sent' INSERT passes the new INSERT-time trigger
insert into public.quote_requests (id, tenant_id, source, status) values
  ('0f300000-0000-4000-8000-0000000000a1','0f300000-0000-4000-8000-000000000001','sample','awaiting_review');
insert into public.drafts (request_id, tenant_id, subject, body) values
  ('0f300000-0000-4000-8000-0000000000a1','0f300000-0000-4000-8000-000000000001','Re','draft body');

-- ── negative: a row BORN 'sent' must be blocked, even for the privileged (RLS-bypassing) session ──
do $$
begin
  begin
    insert into public.quote_requests (tenant_id, source, status) values
      ('0f300000-0000-4000-8000-000000000001','sample','sent');
    raise exception 'HARDENING FAIL: INSERT with status=sent bypassed the enforce-sent gate (trigger is UPDATE-only)';
  exception when check_violation then null;  -- expected: the BEFORE INSERT trigger blocks it
  end;
end $$;

-- ── positive: the approve → finalize path still works through the recreated trigger ──
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1f300000-0000-4000-8000-000000000001"}', true);
do $$
declare v_status text;
begin
  perform public.approve_request('0f300000-0000-4000-8000-0000000000a1');
  select status into v_status from public.quote_requests where id = '0f300000-0000-4000-8000-0000000000a1';
  if v_status is distinct from 'sending' then
    raise exception 'HARDENING FAIL: after approve, status = % (expected sending)', v_status;
  end if;
end $$;
reset role;

do $$
declare v_status text; v_ts timestamptz;
begin
  perform public.finalize_send('0f300000-0000-4000-8000-0000000000a1','0f300000-0000-4000-8000-000000000001', true);
  select status into v_status from public.quote_requests where id = '0f300000-0000-4000-8000-0000000000a1';
  if v_status is distinct from 'sent' then
    raise exception 'HARDENING FAIL: finalize_send blocked by the recreated trigger (status=%, expected sent)', v_status;
  end if;
  select sent_at into v_ts from public.drafts where request_id = '0f300000-0000-4000-8000-0000000000a1';
  if v_ts is null then
    raise exception 'HARDENING FAIL: finalize_send did not stamp drafts.sent_at';
  end if;
end $$;

rollback;

select 'hardening_sent_gate_insert PASS — INSERT born-sent raises check_violation; ordinary inserts pass; approve (sending) -> finalize_send (sent + sent_at) still works through the INSERT OR UPDATE trigger' as result;
