-- P-1C.2 (DB-level idempotency) — a retried durable run never duplicates the quote/draft. quotes.
-- request_id and drafts.request_id are UNIQUE (0001), so insert-once (on conflict do nothing) keeps
-- exactly ONE quote + ONE draft per request, and the originals are preserved even if the retry
-- carries different values (the immutable snapshot — AC-4 parity). Runs in a txn that ROLLS BACK.

begin;

insert into public.tenants (id, name) values ('0f000000-0000-4000-8000-0000000000c1','P-1C.2 Tenant');
insert into public.quote_requests (id, tenant_id, source, status)
  values ('0f000000-0000-4000-8000-0000000000d1','0f000000-0000-4000-8000-0000000000c1','sample','awaiting_review');

do $$
declare n int; v_total int; v_body text;
begin
  -- first run
  insert into public.quotes (request_id, tenant_id, rate_card_version, container_type, container_qty, all_in_total, breakdown_snapshot, validity_through)
    values ('0f000000-0000-4000-8000-0000000000d1','0f000000-0000-4000-8000-0000000000c1','2026-06-v1','40HC',2,6930,'{"all_in_total":6930}'::jsonb,'2026-06-30')
    on conflict (request_id) do nothing;
  insert into public.drafts (request_id, tenant_id, subject, body)
    values ('0f000000-0000-4000-8000-0000000000d1','0f000000-0000-4000-8000-0000000000c1','Re','all-in EUR 6,930.')
    on conflict (request_id) do nothing;

  -- retry attempts to overwrite with DIFFERENT values — must be ignored
  insert into public.quotes (request_id, tenant_id, rate_card_version, container_type, container_qty, all_in_total, breakdown_snapshot, validity_through)
    values ('0f000000-0000-4000-8000-0000000000d1','0f000000-0000-4000-8000-0000000000c1','2026-06-v1','40HC',2,9999,'{"all_in_total":9999}'::jsonb,'2026-06-30')
    on conflict (request_id) do nothing;
  insert into public.drafts (request_id, tenant_id, subject, body)
    values ('0f000000-0000-4000-8000-0000000000d1','0f000000-0000-4000-8000-0000000000c1','Re','RETRY BODY')
    on conflict (request_id) do nothing;

  select count(*) into n from public.quotes where request_id = '0f000000-0000-4000-8000-0000000000d1';
  if n <> 1 then raise exception 'P-1C.2 FAIL: % quote rows for one request (expected 1)', n; end if;
  select count(*) into n from public.drafts where request_id = '0f000000-0000-4000-8000-0000000000d1';
  if n <> 1 then raise exception 'P-1C.2 FAIL: % draft rows for one request (expected 1)', n; end if;

  select all_in_total into v_total from public.quotes where request_id = '0f000000-0000-4000-8000-0000000000d1';
  if v_total <> 6930 then raise exception 'P-1C.2 FAIL: quote overwritten on retry (all_in_total=%)', v_total; end if;
  select body into v_body from public.drafts where request_id = '0f000000-0000-4000-8000-0000000000d1';
  if v_body <> 'all-in EUR 6,930.' then raise exception 'P-1C.2 FAIL: draft overwritten on retry (body=%)', v_body; end if;
end $$;

rollback;

select 'P-1C.2 PASS — retried run inserts-once: exactly one quote + one draft per request, originals preserved (snapshot immutable)' as result;
