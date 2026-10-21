-- P1a hardening (0022, independent security review): owner tokens required, approvals need a readable
-- quote, least-privilege table grants. Rolls back; raises on any failure.
begin;

insert into public.tenants (id, name) values ('0a000000-0000-4000-8000-0000000000d1','Hardening Tenant');
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','1a000000-0000-4000-8000-0000000000d1','authenticated','authenticated','harden@test.local', now(), now());
insert into public.profiles (user_id, tenant_id) values ('1a000000-0000-4000-8000-0000000000d1','0a000000-0000-4000-8000-0000000000d1');
insert into public.quote_requests (id, tenant_id, source, status, claim_owner) values
  ('0c000000-0000-4000-8000-0000000000d1','0a000000-0000-4000-8000-0000000000d1','sample','processing', null),
  ('0c000000-0000-4000-8000-0000000000d2','0a000000-0000-4000-8000-0000000000d1','sample','awaiting_review', null),
  ('0c000000-0000-4000-8000-0000000000d3','0a000000-0000-4000-8000-0000000000d1','sample','awaiting_review', null);
insert into public.drafts (request_id, tenant_id, subject, body) values
  ('0c000000-0000-4000-8000-0000000000d2','0a000000-0000-4000-8000-0000000000d1','Re','draft with no quote'),
  ('0c000000-0000-4000-8000-0000000000d3','0a000000-0000-4000-8000-0000000000d1','Re','draft with an unreadable v2 quote');
insert into public.quotes (request_id, tenant_id, quote_version, mode, currency, total_minor, option_count, breakdown_snapshot, validity_through)
  values ('0c000000-0000-4000-8000-0000000000d3','0a000000-0000-4000-8000-0000000000d1',2,'FCL','EUR',100,1,'{"options":[]}'::jsonb,'2026-12-31');

do $$
declare n int;
begin
  -- 1. an owner-less persist on an owner-less 'processing' row is refused (it used to match: null IS NOT DISTINCT FROM null)
  begin
    perform public.persist_run_outcome('0c000000-0000-4000-8000-0000000000d1','0a000000-0000-4000-8000-0000000000d1','escalated','low_confidence',false,null,null,
      '{"model":"m","input_tokens":1,"output_tokens":1,"est_cost_usd":0}'::jsonb, null, null, null, null);
    raise exception 'HARDEN FAIL: persist without an owner was accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.mark_run_error('0a000000-0000-4000-8000-0000000000d1','0c000000-0000-4000-8000-0000000000d1', null);
    raise exception 'HARDEN FAIL: mark_run_error without an owner was accepted';
  exception when check_violation then null;
  end;
  select count(*) into n from public.quote_requests where id = '0c000000-0000-4000-8000-0000000000d1' and status = 'processing';
  if n <> 1 then raise exception 'HARDEN FAIL: the owner-less row was modified'; end if;

  -- 3. least privilege: anon has no table privileges; authenticated cannot TRUNCATE; internals are append-only
  select count(*) into n from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public';
  if n <> 0 then raise exception 'HARDEN FAIL: anon holds % table privileges in public', n; end if;
  select count(*) into n from information_schema.role_table_grants
   where grantee = 'authenticated' and table_schema = 'public' and privilege_type = 'TRUNCATE';
  if n <> 0 then raise exception 'HARDEN FAIL: authenticated can TRUNCATE % tables (bypasses RLS)', n; end if;
  if has_table_privilege('service_role', 'public.quote_internals', 'UPDATE')
     or has_table_privilege('service_role', 'public.quote_internals', 'TRUNCATE') then
    raise exception 'HARDEN FAIL: pricing receipts in quote_internals can be rewritten';
  end if;
end $$;

-- 2. approval needs a readable quote, enforced by the database (not only the dashboard)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1a000000-0000-4000-8000-0000000000d1"}', true);
do $$
begin
  begin
    perform public.approve_request('0c000000-0000-4000-8000-0000000000d2');
    raise exception 'HARDEN FAIL: a draft with no quote was approved';
  exception when check_violation then null;
  end;
  begin
    perform public.approve_request('0c000000-0000-4000-8000-0000000000d3');
    raise exception 'HARDEN FAIL: a draft whose v2 quote has no options was approved';
  exception when check_violation then null;
  end;
end $$;

rollback;
