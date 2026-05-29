-- AC-1 + P-TENANT (ingest) — the scheduled poll's dedup + tenant scoping at the DB level (1C.1).
-- AC-1: graph_message_id is UNIQUE, so ingesting the same message twice yields exactly ONE
-- quote_request (insert ... on conflict do nothing). P-TENANT: the poll runs as service_role
-- (RLS bypassed), so isolation is CODE-LEVEL — a tenant-scoped read returns only that tenant's
-- 'received' rows, and the per-tenant cursor is independent. Runs in a txn that ROLLS BACK.

begin;

insert into public.tenants (id, name) values
  ('0e000000-0000-4000-8000-0000000000a1','Poll Tenant A'),
  ('0e000000-0000-4000-8000-0000000000b1','Poll Tenant B');

do $$
declare n int;
begin
  -- AC-1: ingest the same graph message twice -> exactly one row.
  insert into public.quote_requests (tenant_id, source, graph_message_id, status)
    values ('0e000000-0000-4000-8000-0000000000a1','poll','AAMk-msg-1','received')
    on conflict (tenant_id, graph_message_id) do nothing;
  insert into public.quote_requests (tenant_id, source, graph_message_id, status)
    values ('0e000000-0000-4000-8000-0000000000a1','poll','AAMk-msg-1','received')
    on conflict (tenant_id, graph_message_id) do nothing;
  select count(*) into n from public.quote_requests where graph_message_id = 'AAMk-msg-1';
  if n <> 1 then raise exception 'AC-1 FAIL: % rows for one graph_message_id (expected 1)', n; end if;

  -- P-TENANT: B ingests its own message; a tenant-scoped read for A excludes B.
  insert into public.quote_requests (tenant_id, source, graph_message_id, status)
    values ('0e000000-0000-4000-8000-0000000000b1','poll','BBMk-msg-1','received')
    on conflict (tenant_id, graph_message_id) do nothing;
  select count(*) into n from public.quote_requests
    where tenant_id = '0e000000-0000-4000-8000-0000000000a1' and status = 'received';
  if n <> 1 then raise exception 'P-TENANT FAIL: tenant-A received count = % (expected 1, A only)', n; end if;
  select count(*) into n from public.quote_requests
    where tenant_id = '0e000000-0000-4000-8000-0000000000a1' and graph_message_id = 'BBMk-msg-1';
  if n <> 0 then raise exception 'P-TENANT FAIL: tenant A can see tenant B''s ingested message'; end if;

  -- per-tenant cursor is independent
  insert into public.poll_state (tenant_id, mailbox, cursor) values
    ('0e000000-0000-4000-8000-0000000000a1','inbox','2026-05-25T10:02:00Z'),
    ('0e000000-0000-4000-8000-0000000000b1','inbox','2026-05-20T00:00:00Z');
  select count(*) into n from public.poll_state
    where tenant_id = '0e000000-0000-4000-8000-0000000000a1' and cursor = '2026-05-25T10:02:00Z';
  if n <> 1 then raise exception 'P-TENANT FAIL: tenant-A cursor not isolated'; end if;

  -- P1-a (codex Gate-4): dedup is TENANT-SCOPED, not global (migration 0008). Both tenants ingest the
  -- SAME graph_message_id and each gets its OWN row — under the old global unique, B's insert was
  -- silently dropped (and the dup count leaked B's existence to A).
  insert into public.quote_requests (tenant_id, source, graph_message_id, status)
    values ('0e000000-0000-4000-8000-0000000000a1','poll','SHARED-msg-1','received')
    on conflict (tenant_id, graph_message_id) do nothing;
  insert into public.quote_requests (tenant_id, source, graph_message_id, status)
    values ('0e000000-0000-4000-8000-0000000000b1','poll','SHARED-msg-1','received')
    on conflict (tenant_id, graph_message_id) do nothing;
  select count(*) into n from public.quote_requests where graph_message_id = 'SHARED-msg-1';
  if n <> 2 then raise exception 'P1-a FAIL: shared graph_message_id across tenants gave % rows (expected 2)', n; end if;
end $$;

rollback;

select 'AC-1 + P-TENANT + P1-a (poll) PASS — (tenant_id, graph_message_id) dedups within a tenant to one request; tenant-scoped reads + per-tenant cursor isolate A from B; two tenants may share a graph_message_id' as result;
