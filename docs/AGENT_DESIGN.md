# AGENT_DESIGN.md — how the QuoteAgent agent is built and why

> Audience: someone evaluating the engineering judgment behind this project. Every claim below is
> grounded in code (file references inline); nothing is aspirational. Domain figures are assumptions,
> logged in `docs/ASSUMPTIONS.md` — never stated as fact.

## The one thesis

**The LLM reads and writes language; deterministic code makes every decision that must be correct.**
Extraction and drafting are the two LLM boundaries. Everything between and after them — the
quote/escalate decision, the price, the safety guards — is plain TypeScript that runs the same way
every time. The agent is interesting not because it calls a model, but because of where it *refuses*
to.

## The pipeline (one email in → draft or escalation out)

`runAgent` (`packages/agents/src/agent.ts`) is pure orchestration, no IO:

```
email
  │
  ▼
[1] extract        LLM (structured output)     → ExtractionResult
  │
  ▼
[2] gate           CODE (deterministic)        → quote | escalate(reason)
  │
  ├── escalate ─────────────────────────────────────────────► AgentOutput(escalate)
  │
  ▼ quote
[3] price          CODE (RateEngine port)      → RateQuote     ← never the LLM
  │
  ▼
[4] retrieve       embeddings + pgvector       → grounding chunks (draft prose only)
  │
  ▼
[5] draft          LLM (structured output)     → Draft (subject, body)
  │
  ▼
[6] injection guard CODE (fail-closed)         → safe? else escalate(guard_violation)
  │
  ▼
[7] canary net     CODE (every path)           → redact + escalate if the canary leaked
  │
  ▼
AgentOutput(quote, draft, usage)
```

Two LLM calls fire on the quote path (extract + draft); on a gate-escalation **only extraction runs**,
and `usage.model` reports exactly which models ran rather than assuming both (`agent.ts:99-101`) — an
honesty detail that matters for cost observability.

## [1] + [5] The two LLM boundaries, and why structured output

Both LLM steps use **forced tool-calling for structured output**, not free-text parsing:
- **Extraction** (`extraction.ts`) returns an `ExtractionResult` validated by `ExtractionResultSchema`
  (`schemas.ts:38`) — origin/destination (raw + resolved UN/LOCODE), mode, container type/qty, incoterm,
  confidences, and an `injection_detected` flag.
- **Drafting** (`draft.ts`) returns a `Draft` (`subject`, `body`) validated by `DraftSchema`.

Why this matters for evals: model output is nondeterministic, so we **never assert exact-string
equality**. Structured output lets tests assert on a normalized schema or a defined pass band at
temperature 0 (see `docs/EVALS.md`). The schema is the contract; the prose is free to vary.

## [3] Deterministic pricing — the central judgment

The price is computed by a `RateEngine` (`rate-engine.ts`), never by the model. A quote is
`base_per_container + per-container surcharges + per-shipment fees`, summed to one integer-EUR all-in
total. The same inputs always produce the same number, and that number is auditable line by line.

This is deliberate: an LLM that "usually" prices correctly is worthless to a freight forwarder who is
contractually bound by the figure they send. Pricing is exactly the kind of decision that must be
**correct, explainable, and reproducible** — so it is code, and the model never sees a number it could
change.

The engine is a **port** (`RateEngine` interface) with swappable adapters: `StaticCardRateEngine`
(in-memory, the test/demo default) and `SupabaseTableRateEngine` (the live table). Q2 added an offline
Excel → Supabase import path feeding the same table. Pricing logic is identical regardless of where the
rate card comes from.

## [4] Scoped RAG — and knowing when *not* to use it

Q3 added retrieval, but only to **ground the human-facing reply prose** — explaining what "BAF" or
"FOB" means — and **never the price**. This is the load-bearing judgment of the whole feature:

- Retrieval runs **after** pricing (`agent.ts:55`), so the number is already fixed before any chunk is
  fetched.
- The retrieval query is built by `buildRetrievalQuery` from **trusted structured fields only** — the
  quote's surcharge/fee codes, lane, container, and an **allowlist-normalized** incoterm — never the
  raw email (`knowledge-retriever.ts`).
- Grounding chunks feed only the draft prompt; the price-fidelity guards (below) run *after* drafting,
  so a retrieved chunk is structurally incapable of moving a number.
- The corpus is **authored, committed, and server-side-only** (`knowledge/*.md` → pgvector
  `knowledge_chunks`, readable/writable only as `service_role`). It is not user-supplied, so it is a
  trusted source by construction.

Embeddings are Gemini Embedding 2 (768-dim) behind an `EmbeddingClient` port (deterministic
`MockEmbeddingClient` for tests, live `GeminiEmbeddingClient` in production). Retrieval is a
`KnowledgeRetriever` port: `EmptyRetriever` (the env-absent default — the agent runs ungrounded with no
key and no crash), `InMemoryKnowledgeRetriever`, and `SupabaseKnowledgeRetriever` (pgvector
`match_knowledge`). The takeaway a reviewer should leave with: **RAG was scoped to the one place it
helps (explanation) and kept out of the one place it would be dangerous (the price).**

## The trusted vs. untrusted boundary

The email is **untrusted input**. The design draws a hard line so nothing the sender writes can reach a
decision:
- The **draft** is fed structured, already-verified fields (names, lane text, the computed quote) — not
  the raw email body — so injection text in the email cannot reach the drafting model (`draft.ts`
  header comment).
- The **retrieval query** uses only engine-trusted fields plus an allowlist-checked incoterm; arbitrary
  text in the email's "incoterm" slot is dropped before it reaches the embedding API.
- Extraction is the *only* step that reads the raw email, and its output is a constrained schema — free
  text becomes typed fields, and `injection_detected` is surfaced as a flag, not an instruction.

## Safety guards — three layers, all fail-closed

1. **The gate invariant** (`gate.ts`): a `quote` decision *guarantees* the request is priceable
   (in-scope mode + lane + container present + qty present), so `price()` cannot throw downstream. This
   is why the extraction container enum is deliberately decoupled from the engine's (Q2 Gate-4 finding):
   the gate only ever passes through what the demo card can price.
2. **The injection guard** (`injection-guard.ts`): after drafting, it checks `canary_leak` (the
   system-prompt canary must never appear in output), `price_mismatch`, and `draft_total_mismatch` (the
   draft must restate the engine's total — `verifyDraftStatesTotal`). Any violation → drop the quote and
   draft, escalate `guard_violation` (`agent.ts:78-84`).
3. **The canary net** (`agent.ts:111-118`): on *every* path — including gate-escalations that never
   reach the injection guard — the whole `AgentOutput` is scanned for `SYSTEM_CANARY`
   (`LINKPORT-CANARY-9F3A21`). If it leaked anywhere, redact and fail closed. This makes "no canary in
   output" an end-to-end invariant, not a best-effort.

"Fail closed" throughout: when anything is wrong, the agent **escalates to a human** rather than sending
a possibly-wrong quote.

## Escalation model

The gate emits a typed `EscalationReason` (`schemas.ts:79`) with first-failing-check precedence
(identity → mode → lane → container → qty → confidence floor of **0.75**, `gate.ts`):
`missing_required_field`, `out_of_scope_mode`, `out_of_scope_lane`, `low_confidence`, plus
`guard_violation` from the guards. `ambiguous_request` is reserved for Phase 1+. The precedence order is
what makes the golden-set reasons come out as specified (e.g. an LCL request with no container details
reports `out_of_scope_mode`, not `missing_required_field`).

## The port/seam pattern (why so many interfaces)

Every external dependency is a port with a mock-for-tests / live-for-production pair, env-gated so the
test suite is hermetic and the demo runs against real services:

| Port | Test double | Live impl | Purpose |
|------|-------------|-----------|---------|
| `LlmClient` | `MockLlmClient` / `RoutingMockLlmClient` | `AnthropicLlmClient` | the two LLM calls, offline-testable |
| `RateEngine` | `StaticCardRateEngine` | `SupabaseTableRateEngine` | deterministic pricing, swappable source |
| `EmbeddingClient` | `MockEmbeddingClient` | `GeminiEmbeddingClient` | embeddings for retrieval |
| `KnowledgeRetriever` | `InMemory` / `Empty` | `SupabaseKnowledgeRetriever` | draft-only grounding |
| `MailboxReader` / `GraphTransport` | stub transport | MS Graph (Phase 1) | live mail ingest |

This is what makes the project both **testable** (164 offline tests, no network/keys) and **honest**
about nondeterminism: the seams let every deterministic claim be tested with a mock, while the live path
swaps in the real model/DB.

## Model routing

`PER_STEP_ROUTING` (`config.ts`): **extraction = `claude-sonnet-4-6`**, **drafting =
`claude-haiku-4-5`**, single-model fallback = Sonnet. The rationale (DECISION_LOG D-07): extraction is
security- and ambiguity-sensitive, so it gets the stronger model; drafting is the easy step and is
backstopped by the deterministic total/canary checks, so it gets the cheaper, faster one.

## What is deliberately out of scope (and where the seams are)

Phase 0 is a CLI vertical slice: email in → draft out. The autonomous path (Trigger.dev poll, MS Graph
ingest, Supabase persistence, the approval dashboard) lives behind the same ports and is documented in
`docs/AUTONOMY.md` / `docs/ARCHITECTURE.md`. No margin/markup, FX, or door-to-door pricing is modelled
(Phase 0 scope choices, `ASSUMPTIONS.md` B/C). The point of the slice is to make the *judgment* legible,
not to be feature-complete.
