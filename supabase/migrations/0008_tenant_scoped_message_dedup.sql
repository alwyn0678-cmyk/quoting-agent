-- 0008 — codex Gate-4 (1C live) P1-a: tenant-scope the inbound-message dedup key.
-- 0001 declared `graph_message_id text unique` = a GLOBAL unique. In a multi-tenant system that runs
-- the poll as service_role (RLS bypassed), a global key means tenant A's ingest is SILENTLY DROPPED if
-- another tenant's mailbox ever yields the same Graph id, and the dedup count leaks a cross-tenant
-- existence signal (P-TENANT violation). A message is unique within ITS tenant's mailbox, so the key
-- must be (tenant_id, graph_message_id). The composite is strictly weaker than the global unique, so
-- existing rows can't violate it — safe to apply in place. NULL graph_message_id (paste/sample) stays
-- non-unique (SQL treats NULLs as distinct), so those requests are unaffected.

alter table public.quote_requests drop constraint if exists quote_requests_graph_message_id_key;

create unique index if not exists quote_requests_tenant_graph_message_id_key
  on public.quote_requests (tenant_id, graph_message_id);
