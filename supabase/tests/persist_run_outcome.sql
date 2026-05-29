-- persist_run_outcome (migration 0009, codex Gate-4 P1-b): the atomic run-persist primitive. ONE txn:
-- insert-once quote + draft, first-writer status flip (processing -> terminal), usage logged on the win.
-- Proves: the first call transitions (returns true) and writes exactly one quote + one draft + one audit
-- row; a SECOND call (status now terminal) is a first-writer no-op (returns false), preserves the
-- originals + status, and adds no audit row — so a retry can neither duplicate nor flip the outcome.
-- Tenant-scoped. Runs in a txn that ROLLS BACK.

begin;

insert into public.tenants (id, name) values ('0c000000-0000-4000-8000-0000000000e1','Persist Tenant');
insert into public.quote_requests (id, tenant_id, source, status)
  values ('0c000000-0000-4000-8000-0000000000f1','0c000000-0000-4000-8000-0000000000e1','poll','processing');

do $$
declare v_first boolean; v_second boolean; n int; v_total int; v_status text; v_audit int;
begin
  -- first call: request is 'processing' -> transitions, writes one quote/draft/audit
  v_first := public.persist_run_outcome(
    '0c000000-0000-4000-8000-0000000000f1','0c000000-0000-4000-8000-0000000000e1',
    'awaiting_review', null, false,
    jsonb_build_object('rate_card_version','2026-06-v1','container_type','40HC','container_qty',2,
                       'all_in_total',6930,'breakdown_snapshot',jsonb_build_object('all_in_total',6930),
                       'validity_through','2026-06-30'),
    jsonb_build_object('subject','Re','body','all-in EUR 6,930.'),
    jsonb_build_object('model','m','input_tokens',100,'output_tokens',50,'est_cost_usd',0.01));
  if not v_first then raise exception 'FAIL: first call should transition (returned false)'; end if;

  -- second call (retry): status is now terminal -> first-writer no-op; DIFFERENT values must be ignored
  v_second := public.persist_run_outcome(
    '0c000000-0000-4000-8000-0000000000f1','0c000000-0000-4000-8000-0000000000e1',
    'escalated','missing_required_field', false,
    jsonb_build_object('rate_card_version','x','container_type','20GP','container_qty',9,
                       'all_in_total',9999,'breakdown_snapshot',jsonb_build_object('all_in_total',9999),
                       'validity_through','2026-06-30'),
    jsonb_build_object('subject','RETRY','body','RETRY'),
    jsonb_build_object('model','m','input_tokens',1,'output_tokens',1,'est_cost_usd',0.99));
  if v_second then raise exception 'FAIL: second call should be a no-op (returned true)'; end if;

  select count(*) into n from public.quotes where request_id='0c000000-0000-4000-8000-0000000000f1';
  if n <> 1 then raise exception 'FAIL: % quote rows (expected 1)', n; end if;
  select count(*) into n from public.drafts where request_id='0c000000-0000-4000-8000-0000000000f1';
  if n <> 1 then raise exception 'FAIL: % draft rows (expected 1)', n; end if;
  select count(*) into v_audit from public.audit_log where request_id='0c000000-0000-4000-8000-0000000000f1';
  if v_audit <> 1 then raise exception 'FAIL: % audit rows (expected 1 — logged once, on the winning transition)', v_audit; end if;

  -- originals + status reflect the FIRST (winning) call, never the second
  select all_in_total into v_total from public.quotes where request_id='0c000000-0000-4000-8000-0000000000f1';
  if v_total <> 6930 then raise exception 'FAIL: quote overwritten on retry (all_in_total=%)', v_total; end if;
  select status into v_status from public.quote_requests where id='0c000000-0000-4000-8000-0000000000f1';
  if v_status <> 'awaiting_review' then raise exception 'FAIL: status flipped by the no-op second call (status=%)', v_status; end if;
end $$;

rollback;

select 'persist_run_outcome PASS — first call transitions + writes one quote/draft/audit; a retry is a first-writer no-op (false), originals + status preserved, no extra audit row' as result;
