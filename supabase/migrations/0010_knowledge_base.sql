-- 0010_knowledge_base.sql — Q3: scoped RAG knowledge corpus (pgvector). Tenant-scoped + RLS like every
-- table (D-15/D-16). The agent retrieves server-side (service_role bypasses RLS) filtered by the
-- explicit p_tenant in match_knowledge() (code-level isolation, P-TENANT). Embeddings are Gemini
-- Embedding 2, 768-dim (MRL-truncated, auto-normalized). ALL corpus CONTENT is INVENTED (ASSUMPTIONS G).
create extension if not exists vector;

create table if not exists public.knowledge_chunks (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id),
  source     text not null,
  title      text not null,
  content    text not null,
  embedding  vector(768) not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, source, title)
);

-- Server-side-only corpus: the indexer writes it and the agent reads it (via match_knowledge), BOTH as
-- service_role, which bypasses RLS and holds DML by default. The browser never touches the corpus, so it
-- gets NO grants here. Granting authenticated INSERT/UPDATE/DELETE would reverse 0003's least-privilege
-- revoke and let a browser user POISON the "trusted" reference knowledge that is later fed to the draft
-- prompt (a prompt-injection channel). RLS + the tenant policy stay on as defense-in-depth (every table
-- is tenant-scoped, D-15/D-16), so the table is closed even if a grant is ever loosened.
alter table public.knowledge_chunks enable row level security;
drop policy if exists knowledge_chunks_by_tenant on public.knowledge_chunks;
create policy knowledge_chunks_by_tenant on public.knowledge_chunks
  for all using (tenant_id = public.auth_tenant_id()) with check (tenant_id = public.auth_tenant_id());

-- cosine top-k for a tenant (explicit p_tenant filter; the agent passes the demo tenant).
create or replace function public.match_knowledge(
  query_embedding vector(768),
  p_tenant uuid,
  match_count int
)
returns table (source text, title text, content text, similarity float)
language sql
stable
as $$
  select k.source, k.title, k.content, 1 - (k.embedding <=> query_embedding) as similarity
  from public.knowledge_chunks k
  where k.tenant_id = p_tenant
  order by k.embedding <=> query_embedding
  limit match_count
$$;

-- Called only by the agent (service_role); never exposed to the browser roles.
grant execute on function public.match_knowledge(vector, uuid, int) to service_role;
