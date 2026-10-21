-- P1a expand (0021): v1/v2 quote persistence, owner-checked lease, cost confidentiality, requeue
-- cleanup, atomic rate-card read, final reasons. Rolls back; raises on any failure.
begin;

insert into public.tenants (id, name) values ('0a000000-0000-4000-8000-0000000000e1','Expand Tenant');
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','1a000000-0000-4000-8000-0000000000e1','authenticated','authenticated','expand@test.local', now(), now());
insert into public.profiles (user_id, tenant_id) values ('1a000000-0000-4000-8000-0000000000e1','0a000000-0000-4000-8000-0000000000e1');
insert into public.quote_requests (id, tenant_id, source, status) values
  ('0c000000-0000-4000-8000-0000000000e1','0a000000-0000-4000-8000-0000000000e1','sample','received'),
  ('0c000000-0000-4000-8000-0000000000e2','0a000000-0000-4000-8000-0000000000e1','sample','received'),
  ('0c000000-0000-4000-8000-0000000000e3','0a000000-0000-4000-8000-0000000000e1','sample','received');

do $$
declare n int; ok boolean; v record;
begin
  -- lease: run A claims; run B cannot; run A (retry of the same run) can reclaim
  select count(*) into n from public.claim_request('0a000000-0000-4000-8000-0000000000e1','0c000000-0000-4000-8000-0000000000e1','run_A');
  if n <> 1 then raise exception 'EXPAND FAIL: first claim'; end if;
  select count(*) into n from public.claim_request('0a000000-0000-4000-8000-0000000000e1','0c000000-0000-4000-8000-0000000000e1','run_B');
  if n <> 0 then raise exception 'EXPAND FAIL: another run stole a live lease'; end if;
  select count(*) into n from public.claim_request('0a000000-0000-4000-8000-0000000000e1','0c000000-0000-4000-8000-0000000000e1','run_A');
  if n <> 1 then raise exception 'EXPAND FAIL: same-run retry could not reclaim'; end if;

  -- a crashed run's stale lease (older than 70 min) can be taken over by a new run
  perform public.claim_request('0a000000-0000-4000-8000-0000000000e1','0c000000-0000-4000-8000-0000000000e3','run_dead');
  update public.quote_requests set claimed_at = now() - interval '2 hours' where id = '0c000000-0000-4000-8000-0000000000e3';
  select count(*) into n from public.claim_request('0a000000-0000-4000-8000-0000000000e1','0c000000-0000-4000-8000-0000000000e3','run_new');
  if n <> 1 then raise exception 'EXPAND FAIL: stale lease not recoverable'; end if;
  if public.mark_run_error('0a000000-0000-4000-8000-0000000000e1','0c000000-0000-4000-8000-0000000000e3','run_dead') then
    raise exception 'EXPAND FAIL: the dead run could still mark the request as error';
  end if;

  -- a foreign owner cannot persist or mark error
  ok := public.persist_run_outcome('0c000000-0000-4000-8000-0000000000e1','0a000000-0000-4000-8000-0000000000e1','escalated','low_confidence',false,null,null,
        '{"model":"m","input_tokens":1,"output_tokens":1,"est_cost_usd":0}'::jsonb, null, null, null, 'run_B');
  if ok then raise exception 'EXPAND FAIL: foreign owner persisted'; end if;
  if public.mark_run_error('0a000000-0000-4000-8000-0000000000e1','0c000000-0000-4000-8000-0000000000e1','run_B') then
    raise exception 'EXPAND FAIL: foreign owner marked error';
  end if;

  -- owner persists a v2 quote with outcome detail and internals
  ok := public.persist_run_outcome('0c000000-0000-4000-8000-0000000000e1','0a000000-0000-4000-8000-0000000000e1','awaiting_review',null,false,
        jsonb_build_object('quote_version',2,'mode','FCL','currency','EUR','total_minor','876803','option_count',1,
                           'breakdown_snapshot','{"presented":[]}'::jsonb,'validity_through','2026-11-04'),
        '{"subject":"Re","body":"draft"}'::jsonb,
        '{"model":"m","input_tokens":1,"output_tokens":1,"est_cost_usd":0}'::jsonb,
        '{"mode":"FCL"}'::jsonb, '{"options_presented":1}'::jsonb, '{"candidates":[{"buy":"secret"}]}'::jsonb, 'run_A');
  if not ok then raise exception 'EXPAND FAIL: owner v2 persist'; end if;
  select * into v from public.quotes where request_id = '0c000000-0000-4000-8000-0000000000e1';
  if v.quote_version <> 2 or v.total_minor <> 876803 or v.currency <> 'EUR' or v.all_in_total is not null then
    raise exception 'EXPAND FAIL: v2 quote row shape %', row_to_json(v);
  end if;
  select count(*) into n from public.quote_internals where request_id = '0c000000-0000-4000-8000-0000000000e1';
  if n <> 1 then raise exception 'EXPAND FAIL: internals not stored'; end if;

  -- version-shape check rejects a malformed v2 row
  begin
    insert into public.quotes (request_id, tenant_id, quote_version, mode, currency, total_minor, option_count, breakdown_snapshot, validity_through)
    values ('0c000000-0000-4000-8000-0000000000e2','0a000000-0000-4000-8000-0000000000e1',2,'FCL','XXX',1,1,'{}'::jsonb,'2026-11-04');
    raise exception 'EXPAND FAIL: bad currency accepted';
  exception when check_violation then null;
  end;

  -- new reasons are accepted
  update public.quote_requests set status = 'escalated', escalation_reason = 'out_of_scope_service'
   where id = '0c000000-0000-4000-8000-0000000000e2';

  -- atomic rate-card read returns card + ordered lines
  insert into public.rate_cards (id, tenant_id, lane, version, validity_through, is_active, mode)
    values ('0d000000-0000-4000-8000-0000000000e1','0a000000-0000-4000-8000-0000000000e1','NLRTM-USNYC','x','2026-12-31',true,'FCL');
  insert into public.rate_card_lines (rate_card_id, kind, code, container_type, amount, sort_order) values
    ('0d000000-0000-4000-8000-0000000000e1','base','BASE_40HC','40HC',2550,0),
    ('0d000000-0000-4000-8000-0000000000e1','per_shipment_fee','DOC',null,65,0);
  if jsonb_array_length(public.get_rate_card('0a000000-0000-4000-8000-0000000000e1','FCL','NLRTM-USNYC')->'lines') <> 2 then
    raise exception 'EXPAND FAIL: get_rate_card lines';
  end if;
end $$;

-- cost confidentiality: an authenticated tenant member cannot read internals
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1a000000-0000-4000-8000-0000000000e1"}', true);
do $$
declare n int;
begin
  begin
    select count(*) into n from public.quote_internals;
    raise exception 'EXPAND FAIL: authenticated read quote_internals';
  exception when insufficient_privilege then null;
  end;
  -- requeue (human) clears the previous run, including internals
  perform public.requeue_request('0c000000-0000-4000-8000-0000000000e2');
end $$;
reset role;

do $$
declare v record; n int;
begin
  select * into v from public.quote_requests where id = '0c000000-0000-4000-8000-0000000000e2';
  if v.status <> 'received' or v.outcome_detail is not null or v.claim_owner is not null then
    raise exception 'EXPAND FAIL: requeue left run state behind';
  end if;
end $$;

rollback;
select 'PASS: P1a expand migration' as result;
