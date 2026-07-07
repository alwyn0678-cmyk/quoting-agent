-- hardening: stale send lease on requeue (migration 0015 §6). 0011's requeue_request cleared
-- escalation_reason / injection_flag / archived_at but NOT send_claimed_at — so a request that was
-- once claimed for send and later reconciled to escalated/error would, after requeue → re-run →
-- re-approve, sit in 'sending' forever (claim_for_send only picks send_claimed_at IS NULL rows and
-- the lease is never auto-reclaimed). Proves: an authenticated reviewer requeues an escalated,
-- previously-claimed, archived request → status back to 'received', send_claimed_at NULL (the key
-- assert), prior outcome fields cleared, prior draft dropped. Negative: a 'sending' row (in-flight
-- real send) is still NOT requeueable. Runs in a txn that ROLLS BACK.

begin;

insert into public.tenants (id, name) values ('0f400000-0000-4000-8000-000000000001','Requeue Tenant');

insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','1f400000-0000-4000-8000-000000000001','authenticated','authenticated','requeue@test.local', now(), now());
insert into public.profiles (user_id, tenant_id) values
  ('1f400000-0000-4000-8000-000000000001','0f400000-0000-4000-8000-000000000001');

-- an escalated request carrying every field requeue must reset — INCLUDING a stale send lease —
-- plus a leftover draft that must be dropped for the fresh re-run
insert into public.quote_requests
    (id, tenant_id, source, status, escalation_reason, injection_flag, archived_at, send_claimed_at)
  values
    ('0f400000-0000-4000-8000-0000000000a1','0f400000-0000-4000-8000-000000000001',
     'sample','escalated','low_confidence', true, now(), now());
insert into public.drafts (request_id, tenant_id, subject, body) values
  ('0f400000-0000-4000-8000-0000000000a1','0f400000-0000-4000-8000-000000000001','Re','stale draft');

-- a 'sending' row with a live lease, to prove requeue still refuses in-flight sends
insert into public.quote_requests (id, tenant_id, source, status, send_claimed_at) values
  ('0f400000-0000-4000-8000-0000000000b1','0f400000-0000-4000-8000-000000000001','sample','sending', now());

-- ── caller = the tenant's reviewer ──
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1f400000-0000-4000-8000-000000000001"}', true);
do $$
begin
  perform public.requeue_request('0f400000-0000-4000-8000-0000000000a1');

  -- negative: an in-flight 'sending' row must remain untouchable (no resend path)
  begin
    perform public.requeue_request('0f400000-0000-4000-8000-0000000000b1');
    raise exception 'HARDENING FAIL: requeued a sending (in-flight) request';
  exception when check_violation then null;  -- expected: refused by the RPC's state check
  end;
end $$;
reset role;

-- verify as the privileged session (bypasses RLS)
do $$
declare v_status text; v_lease timestamptz; v_reason text; v_flag boolean; v_arch timestamptz; n int;
begin
  select status, send_claimed_at, escalation_reason, injection_flag, archived_at
    into v_status, v_lease, v_reason, v_flag, v_arch
    from public.quote_requests where id = '0f400000-0000-4000-8000-0000000000a1';
  if v_status is distinct from 'received' then
    raise exception 'HARDENING FAIL: requeued status = % (expected received)', v_status;
  end if;
  if v_lease is not null then
    raise exception 'HARDENING FAIL: send_claimed_at survived requeue (stale lease would strand the re-approved send)';
  end if;
  if v_reason is not null then raise exception 'HARDENING FAIL: escalation_reason survived requeue (%)', v_reason; end if;
  if v_flag then raise exception 'HARDENING FAIL: injection_flag survived requeue'; end if;
  if v_arch is not null then raise exception 'HARDENING FAIL: archived_at survived requeue'; end if;
  select count(*) into n from public.drafts where request_id = '0f400000-0000-4000-8000-0000000000a1';
  if n <> 0 then raise exception 'HARDENING FAIL: stale draft survived requeue (% rows)', n; end if;
end $$;

rollback;

select 'hardening_requeue_lease PASS — requeue resets a re-run to received with send_claimed_at NULL (plus reason/flag/archive cleared, stale draft dropped); an in-flight sending row is still refused' as result;
