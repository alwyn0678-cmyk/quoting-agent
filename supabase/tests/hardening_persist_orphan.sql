-- hardening: persist_run_outcome orphan-write fix (migration 0015 §3). The 0009 body ran the
-- quote/draft INSERTs BEFORE the first-writer status flip, so this exact ordering — first run
-- ESCALATES, a divergent retry produces a QUOTE — committed an orphan quote+draft onto the already-
-- escalated request (the ordering tests/persist_run_outcome.sql missed: it quoted first). Proves:
-- the escalate call wins (true); the divergent quote retry loses (false) and persists NOTHING —
-- zero quote rows, zero draft rows, status stays 'escalated', exactly one audit row (the winner's).
-- Runs in a txn that ROLLS BACK.

begin;

insert into public.tenants (id, name) values ('0f200000-0000-4000-8000-000000000001','Orphan Tenant');
insert into public.quote_requests (id, tenant_id, source, status)
  values ('0f200000-0000-4000-8000-0000000000f1','0f200000-0000-4000-8000-000000000001','poll','processing');

do $$
declare v_first boolean; v_second boolean; n int; v_status text;
begin
  -- first call: the run ESCALATES → wins the flip, writes no quote/draft, logs one audit row
  v_first := public.persist_run_outcome(
    '0f200000-0000-4000-8000-0000000000f1','0f200000-0000-4000-8000-000000000001',
    'escalated','low_confidence', false,
    null, null,
    jsonb_build_object('model','m','input_tokens',80,'output_tokens',20,'est_cost_usd',0.008));
  if not v_first then raise exception 'FAIL: first (escalate) call should transition (returned false)'; end if;

  -- second call: a DIVERGENT retry that produced a quote → must lose the flip and write NOTHING
  v_second := public.persist_run_outcome(
    '0f200000-0000-4000-8000-0000000000f1','0f200000-0000-4000-8000-000000000001',
    'awaiting_review', null, false,
    jsonb_build_object('rate_card_version','2026-06-v1','container_type','40HC','container_qty',2,
                       'all_in_total',6930,'breakdown_snapshot',jsonb_build_object('all_in_total',6930),
                       'validity_through','2026-06-30'),
    jsonb_build_object('subject','Re','body','all-in EUR 6,930.'),
    jsonb_build_object('model','m','input_tokens',100,'output_tokens',50,'est_cost_usd',0.01));
  if v_second then raise exception 'FAIL: losing divergent retry should be a no-op (returned true)'; end if;

  -- the retry's quote/draft must NOT exist (under 0009's ordering both rows persisted — the orphan)
  select count(*) into n from public.quotes where request_id='0f200000-0000-4000-8000-0000000000f1';
  if n <> 0 then raise exception 'FAIL: orphan quote persisted on an escalated request (% rows, expected 0)', n; end if;
  select count(*) into n from public.drafts where request_id='0f200000-0000-4000-8000-0000000000f1';
  if n <> 0 then raise exception 'FAIL: orphan draft persisted on an escalated request (% rows, expected 0)', n; end if;

  -- the winning outcome is untouched
  select status into v_status from public.quote_requests where id='0f200000-0000-4000-8000-0000000000f1';
  if v_status <> 'escalated' then raise exception 'FAIL: status flipped by the losing retry (status=%, expected escalated)', v_status; end if;
  select count(*) into n from public.audit_log where request_id='0f200000-0000-4000-8000-0000000000f1';
  if n <> 1 then raise exception 'FAIL: % audit rows (expected 1 — the winner''s only)', n; end if;
end $$;

rollback;

select 'hardening_persist_orphan PASS — escalate-first wins; a divergent quote retry returns false and persists NO quote, NO draft, NO extra audit row; status stays escalated' as result;
