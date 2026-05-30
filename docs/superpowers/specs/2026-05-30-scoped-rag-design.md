# Spec — Scoped RAG knowledge layer (Q3): ground the draft, not the price

- **Date:** 2026-05-30
- **Status:** approved design (Approach A, draft-only, Gemini Embedding 2 + pgvector), pre-implementation
- **Workstream:** Q3 (scoped RAG)
- **Scope:** a curated knowledge corpus + Gemini Embedding 2 + Supabase pgvector retrieval that grounds
  **only the draft reply prose**. Pricing, the gate, and extraction are untouched. The portfolio point
  is **knowing when *not* to use RAG**: pricing stays exact/structured; RAG explains terms.

## Goal

The drafted reply can correctly explain the line items it quotes (what BAF / THC / ISPS mean, the
customer's incoterm, Linkport's standard terms) by retrieving short, trusted, authored knowledge
snippets — never by inventing them, and never touching the price. Retrieval uses **Gemini Embedding 2**
over a **Supabase pgvector** store; generation stays Anthropic (clean provider separation).

## Decisions (locked)

- **Draft-only grounding.** No new escalation-explanation step (explicit follow-on). The gate stays
  deterministic; extraction/pricing untouched.
- **Embeddings = Gemini Embedding 2** (`gemini-embedding-2`), **768-dim** (MRL-truncated, auto-normalized),
  task given as an in-prompt instruction (v2 has no `task_type` param). Single config constant; the exact
  model-id string is a **VERIFY** assumption, confirmed at the live smoke. `GEMINI_API_KEY` in `.env`.
- **Store = Supabase pgvector** (new migration), tenant-scoped + RLS like every table.
- **Corpus = 4 authored sources** (all INVENTED): surcharge/fee glossary, incoterms glossary, Linkport
  quoting policy/terms, lane & port facts (kept minimal — most prone to invented operational claims).
- **Retrieval query is built from trusted STRUCTURED fields** (the quote's fee/surcharge codes + incoterm
  + lane) — **never the raw untrusted email**. This preserves the trusted-vs-untrusted boundary.
- **Env-gated + stub-safe:** no `GEMINI_API_KEY`/Supabase env → an empty retriever → the draft is
  ungrounded (exactly today's behaviour). Mirrors the `hasGraphEnv` poll pattern.
- **Vector retrieval over the whole corpus** (top-k). Exact-code lookup for the glossary is a noted
  follow-on, not this slice.

## Architecture & components

```
knowledge/*.md            authored corpus (surcharges, incoterms, policy, lanes) — all INVENTED
   │ chunkCorpus() (pure)
   ▼
KnowledgeChunk[] {source,title,content}
   │ EmbeddingClient.embed(texts, "document")   ← Gemini Embedding 2 (gemini-embedding-2, 768-dim)
   ▼
scripts/index_knowledge.ts  → upsert into knowledge_chunks (pgvector)   [LIVE, deferred]

runAgent (quote path, AFTER price, BEFORE draft):
  buildRetrievalQuery(quote, incoterm)  (pure, from STRUCTURED fields)
   │ KnowledgeRetriever.retrieve(query, k)
   ▼  (SupabaseKnowledgeRetriever: embed query → rpc match_knowledge cosine top-k
   │   | InMemoryKnowledgeRetriever: embed corpus + cosineRank (hermetic test double / no-DB mode)
   │   | EmptyRetriever: [] (env-absent default))
  KnowledgeChunk[]  → generateDraft(..., groundingContext)  → grounded prose
   │
  verifyDraftStatesTotal + injection guard + canary  (UNCHANGED — price integrity preserved)
```

### Files

| File | Responsibility |
|---|---|
| `knowledge/{surcharges,incoterms,policy,lanes}.md` (create) | the authored corpus (INVENTED) |
| `packages/agents/src/chunk-corpus.ts` (create) | pure `chunkCorpus(md, source) → KnowledgeChunk[]` |
| `packages/agents/src/embedding-client.ts` (create) | `EmbeddingClient` port + `MockEmbeddingClient` + `cosineRank` |
| `packages/agents/src/gemini-embedding-client.ts` (create) | `GeminiEmbeddingClient` (REST, fetch) + `hasGeminiEnv` |
| `packages/agents/src/knowledge-retriever.ts` (create) | `KnowledgeRetriever` port + `InMemory` + `Supabase` + `Empty`; `buildRetrievalQuery` |
| `packages/agents/src/draft.ts` (modify) | `DraftInput.groundingContext?` + a reference-knowledge prompt block (empty ⇒ unchanged) |
| `packages/agents/src/agent.ts` (modify) | inject a `KnowledgeRetriever` (default `EmptyRetriever`); retrieve before draft on the quote path |
| `supabase/migrations/0010_knowledge_base.sql` (create) | `vector` ext + `knowledge_chunks` + RLS + `match_knowledge()` |
| `scripts/index_knowledge.ts` (create) | read corpus → chunk → embed → idempotent upsert (LIVE, deferred) |
| `evals/rag-retrieval.ts` (create) | live pass-band eval (deferred) |
| `.env.example`, `config.ts` (modify) | `GEMINI_API_KEY`, `GEMINI_EMBEDDING_MODEL`, `EMBEDDING_DIMS` |
| `docs/ASSUMPTIONS.md` (modify) | new corpus section (all INVENTED) + the model-id VERIFY |

### Embedding client (the port)

```ts
export type EmbeddingTask = "document" | "query"; // -> in-prompt instruction for gemini-embedding-2
export interface EmbeddingClient {
  embed(texts: string[], task: EmbeddingTask): Promise<number[][]>; // 768-dim each, order-preserving
}
```
- `GeminiEmbeddingClient`: `POST https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent`
  per text (or `:batchEmbedContents` for the corpus), header `x-goog-api-key`, body
  `{ content:{parts:[{text: "task: <retrieval document|search result> | query: " + text}]}, output_dimensionality: 768 }`.
  Non-2xx throws; the response vector length is asserted to equal `EMBEDDING_DIMS`.
- `MockEmbeddingClient`: deterministic vectors derived from the text (e.g. a hashed bag-of-words over a
  fixed code vocabulary) so a "BAF" query embeds nearest the "BAF" chunk — gives **hermetic, deterministic
  retrieval tests** without a network or DB.
- `cosineRank(queryVec, items, k)`: pure top-k by cosine — the ranking logic, unit-tested.

### Vector store + retrieval

- `0010_knowledge_base.sql`: `create extension if not exists vector;`
  `knowledge_chunks(id uuid pk, tenant_id uuid, source text, title text, content text,
  embedding vector(768), created_at timestamptz default now())`; unique `(tenant_id, source, title)`
  (idempotent upsert); RLS enabled, tenant-scoped policy consistent with the other tables. A
  `match_knowledge(query_embedding vector(768), p_tenant uuid, match_count int)` SQL function returns the
  top matches by cosine (`order by embedding <=> query_embedding`, `1 - (embedding <=> query_embedding)`
  as similarity). No ANN index — an exact scan is correct and ample for a ~50-chunk corpus (noted).
- `SupabaseKnowledgeRetriever.retrieve(query, k)`: `embed([query], "query")` → `rpc('match_knowledge', …)`
  for the demo tenant → `KnowledgeChunk[]`. Server-side service_role (the agent path), filtered by tenant.
- `InMemoryKnowledgeRetriever(chunks, embeddingClient)`: embeds the corpus once + `cosineRank` — the test
  double AND a no-DB live option. `EmptyRetriever`: returns `[]` (env-absent default).

### Draft integration (surgical, backward-compatible)

- `DraftInput` gains `groundingContext?: KnowledgeChunk[]` (default none). When present,
  `buildDraftUserContent` appends a clearly-delimited **"Reference knowledge (authored; use ONLY to
  explain terms accurately — never change, add to, or contradict the figures above)"** block, and the
  system prompt adds one rule: explanations must come only from that block; don't invent. **Empty
  grounding ⇒ byte-identical to today's prompt**, so existing draft tests/goldens stay green.
- `runAgent` gains a `retriever: KnowledgeRetriever = new EmptyRetriever()` param. On the quote path,
  after pricing: `const ctx = await retriever.retrieve(buildRetrievalQuery(quote, extraction.incoterm), K)`,
  passed into `generateDraft`. Price is computed **before** retrieval; `verifyDraftStatesTotal` + the
  injection guard + the canary net are unchanged → **RAG cannot alter the price**.

## Testing (every AC = one pass/fail test; hermetic unless marked live)

- **AC-R1 (chunking, pure):** `chunkCorpus` splits a sample doc into the expected discrete
  `{source,title,content}` chunks (splits on `##`, drops blanks) → unit test.
- **AC-R2 (query build, pure):** `buildRetrievalQuery` includes every fee/surcharge **code** in the quote
  + the incoterm + the lane, and contains **no** raw-email text → unit test.
- **AC-R3 (deterministic retrieval, hermetic):** with `MockEmbeddingClient` + `InMemoryKnowledgeRetriever`
  over a small fixture corpus, a BAF-containing query returns the BAF chunk in top-k (and `cosineRank`
  orders by similarity) → unit test. Proves retrieval works without network/DB.
- **AC-R4 (draft grounding, mock LLM):** `buildDraftUserContent` carries the reference block when grounding
  is supplied, and is **unchanged** when it is empty (the existing draft tests still pass) → unit test.
- **AC-R5 (price integrity):** a grounded draft over a fixture still passes `verifyDraftStatesTotal` and the
  injection guard; grounding chunks never reach the price → unit test (mock LLM returns prose embedding the
  correct total + a retrieved term).
- **AC-R6 (LIVE, deferred):** `evals/rag-retrieval.ts` — real Gemini Embedding 2 over the indexed corpus:
  a BAF/incoterm query retrieves the relevant chunk in top-3 (pass-band), and a live draft explains a
  retrieved term while re-stating the exact total. Batched with the end-of-project live tests.

> Non-pass/fail (build artifacts / live): generating embeddings, the `index_knowledge` upsert, and the
> live eval are not hermetic ACs — consistent with "if it can't be a test, it's not a criterion."

## ASSUMPTIONS additions (all part of this build)

- New section **"G. Knowledge corpus (Q3 RAG — all INVENTED/curated)"**: every glossary definition,
  policy clause, and lane/port note is authored content for the fictional Linkport, not sourced from
  authority — same `claim · source · how-to-verify` discipline; lane/port operational notes flagged
  especially (transit/routing claims are invented).
- The **Gemini model-id string** `gemini-embedding-2` + the 768-dim/auto-normalize behaviour → **VERIFY**
  (confirm against Google's current API at the live smoke; the id is a single config constant to swap).

## Out of scope / deferred (explicit)

- **No RAG for pricing** — the whole point; pricing stays exact/structured. Retrieval feeds only the draft.
- **No escalation-explanation step** (draft-only this slice).
- **No exact-code glossary lookup hybrid** (vector-only retrieval this slice; hybrid is a noted follow-on).
- **No ANN index** (exact scan suffices for the corpus size).
- **Live runs deferred** to the end-of-project batch: `index_knowledge` (embed + upsert) and AC-R6.
- Embedding token-cost is not added to the stdout cost log (a later observability refinement).
