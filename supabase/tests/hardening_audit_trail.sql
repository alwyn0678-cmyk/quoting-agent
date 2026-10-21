-- Audit trail (P0): every quote_requests state change is attributed, and the model's extraction is
-- persisted with the run outcome. Proves:
--   1. persist_run_outcome stores the extraction JSON on the request (reviewers/auditors can see what
--      the model read) and the worker's transition is recorded with actor = null (system).
--   2. A human approve (authenticated user A) writes a 'transition' audit row awaiting_review →
--      sending with actor_id = A.
--   3. archive is recorded as its own attributed event.
--   4. audit rows are not writable by authenticated users (no forged history).
-- Rolls back; raises on any failure.
begin;

insert into public.tenants (id, name) values ('0a000000-0000-4000-8000-0000000000f1','Audit Tenant');
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','1a000000-0000-4000-8000-0000000000f1','authenticated','authenticated','audit-a@test.local', now(), now());
insert into public.profiles (user_id, tenant_id) values
  ('1a000000-0000-4000-8000-0000000000f1','0a000000-0000-4000-8000-0000000000f1');
insert into public.quote_requests (id, tenant_id, source, status) values
  ('0c000000-0000-4000-8000-0000000000f1','0a000000-0000-4000-8000-0000000000f1','sample','processing'),
  ('0c000000-0000-4000-8000-0000000000f2','0a000000-0000-4000-8000-0000000000f1','sample','escalated');

-- 1. worker persists a quote outcome with the extraction (runs as the privileged session, like service_role)
do $$
declare v_ok boolean; v_extr jsonb; v_actor uuid; v_n int;
begin
  v_ok := public.persist_run_outcome(
    '0c000000-0000-4000-8000-0000000000f1', '0a000000-0000-4000-8000-0000000000f1',
    'awaiting_review', null, false,
    jsonb_build_object('rate_card_version','t','container_type','40HC','container_qty',1,
                       'all_in_total',100,'breakdown_snapshot','{}'::jsonb,'validity_through','2026-12-31'),
    jsonb_build_object('subject','Re','body','draft'),
    jsonb_build_object('model','anthropic/claude-opus-5-5','input_tokens',10,'output_tokens',5,'est_cost_usd',0.0001),
    jsonb_build_object('mode','FCL','container_type','40HC'));
  if not v_ok then raise exception 'AUDIT FAIL: persist_run_outcome did not transition'; end if;

  select extraction into v_extr from public.quote_requests where id = '0c000000-0000-4000-8000-0000000000f1';
  if v_extr->>'mode' is distinct from 'FCL' then
    raise exception 'AUDIT FAIL: extraction not persisted (got %)', v_extr;
  end if;

  select count(*), max(actor_id::text)::uuid into v_n, v_actor from public.audit_log
   where request_id = '0c000000-0000-4000-8000-0000000000f1' and event = 'transition'
     and detail->>'from' = 'processing' and detail->>'to' = 'awaiting_review';
  if v_n <> 1 or v_actor is not null then
    raise exception 'AUDIT FAIL: worker transition not recorded once with a null (system) actor (n=%, actor=%)', v_n, v_actor;
  end if;
end $$;

-- 2–4. as reviewer A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1a000000-0000-4000-8000-0000000000f1"}', true);

do $$
begin
  perform public.approve_request('0c000000-0000-4000-8000-0000000000f1');
  perform public.archive_request('0c000000-0000-4000-8000-0000000000f2');  -- archive needs a terminal request
  begin
    insert into public.audit_log (tenant_id, event) values ('0a000000-0000-4000-8000-0000000000f1', 'forged');
    raise exception 'AUDIT FAIL: authenticated inserted an audit row directly';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

do $$
declare v_n int;
begin
  select count(*) into v_n from public.audit_log
   where request_id = '0c000000-0000-4000-8000-0000000000f1' and event = 'transition'
     and detail->>'from' = 'awaiting_review' and detail->>'to' = 'sending'
     and actor_id = '1a000000-0000-4000-8000-0000000000f1';
  if v_n <> 1 then raise exception 'AUDIT FAIL: approve not attributed to the reviewer (n=%)', v_n; end if;

  select count(*) into v_n from public.audit_log
   where request_id = '0c000000-0000-4000-8000-0000000000f2' and event = 'archived'
     and actor_id = '1a000000-0000-4000-8000-0000000000f1';
  if v_n <> 1 then raise exception 'AUDIT FAIL: archive not attributed (n=%)', v_n; end if;
end $$;

-- 5. (Codex review 2) attribution survives account deletion; per-run extraction is immutable in the
--    run's audit row; a requeue clears the request's CURRENT extraction.
do $$
declare v_n int; v_extr jsonb;
begin
  select count(*) into v_n from public.audit_log
   where request_id = '0c000000-0000-4000-8000-0000000000f1' and event = 'transition'
     and detail->>'to' = 'sending' and actor_type = 'user';
  if v_n <> 1 then raise exception 'AUDIT FAIL: human transition lacks actor_type=user'; end if;

  select count(*) into v_n from public.audit_log
   where request_id = '0c000000-0000-4000-8000-0000000000f1' and event = 'transition'
     and detail->>'to' = 'awaiting_review' and actor_type = 'system';
  if v_n <> 1 then raise exception 'AUDIT FAIL: worker transition lacks actor_type=system'; end if;

  delete from auth.users where id = '1a000000-0000-4000-8000-0000000000f1';
  select count(*) into v_n from public.audit_log
   where request_id = '0c000000-0000-4000-8000-0000000000f1' and detail->>'to' = 'sending'
     and actor_id is null and actor_type = 'user';
  if v_n <> 1 then raise exception 'AUDIT FAIL: deleting the reviewer rewrote a human action as system'; end if;

  select detail->'extraction' into v_extr from public.audit_log
   where request_id = '0c000000-0000-4000-8000-0000000000f1' and event = 'quote';
  if v_extr->>'mode' is distinct from 'FCL' then
    raise exception 'AUDIT FAIL: the run''s extraction is not kept in its audit row (got %)', v_extr;
  end if;

  -- the remaining updates are system actions (the deleted reviewer's claims must not linger)
  perform set_config('request.jwt.claims', '', true);
  update public.quote_requests set status = 'escalated', extraction = '{"mode":"FCL"}'::jsonb
   where id = '0c000000-0000-4000-8000-0000000000f2';
  update public.quote_requests set status = 'received' where id = '0c000000-0000-4000-8000-0000000000f2';
  select extraction into v_extr from public.quote_requests where id = '0c000000-0000-4000-8000-0000000000f2';
  if v_extr is not null then raise exception 'AUDIT FAIL: requeue left a stale extraction on the request'; end if;
end $$;

rollback;
select 'PASS: audit trail attributes every transition and persists the extraction' as result;
