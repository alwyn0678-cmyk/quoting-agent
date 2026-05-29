# ARCHITECTURE.md — Production (Phase 1+)

> **Architecture: Option C — hybrid pipeline with a swappable `RateEngine` port** (DECISION_LOG
> D-12/D-11). Evolves the Phase 0 CLI slice into a multi-tenant, human-in-the-loop quoting agent
> over the forwarder's existing Excel rate engine, without making the Excel dependency load-bearing.

## System context

```
   Customer email (Outlook)
        │  MS Graph (subscription/webhook)
        ▼
  ┌─────────────────┐     enqueue      ┌──────────────────────────┐
  │ apps/web (Vercel)│ ───────────────▶ │ Trigger.dev v3 task       │
  │  webhook + dash  │                  │  the agent pipeline run   │
  └─────────────────┘                  └──────────┬───────────────┘
        ▲  read/approve                            │
        │                                          │  extract→gate→price→draft→guard
        │                              ┌───────────┼───────────────────────┐
        │                              ▼           ▼                       ▼
        │                       packages/agents  RateEngine port      packages/graph
        │                       (Phase 0 core)   (adapter)            (Outlook + Excel)
        │                                          │
        │                                  ┌───────┴────────┐
        │                                  ▼                ▼
        │                          Supabase table     Excel Online (MS Graph)
        │                          adapter (ship)     adapter (swap-in, Week 6)
        │
   Human approves draft in dashboard ──▶ send reply (MS Graph)  ·  all steps logged to Supabase
```

## Components

| Component | Path | Role | Phase |
|---|---|---|---|
| **Agent core** | `packages/agents` | extract (LLM) · gate (code) · draft (LLM) · injection guard (code). **Reused from Phase 0 unchanged.** | built (P0) |
| **RateEngine port** | `packages/agents` | `interface RateEngine { price(req: PriceRequest): Promise<RateQuote> }`. Phase 0's `priceQuote()` is the seam. | 1A |
| → StaticCard adapter | `packages/agents` | the Phase 0 in-repo card (tests/fallback) | built (P0) |
| → SupabaseTable adapter | `packages/agents` | rate card rows in Supabase — **the shippable production engine** | 1B |
| → ExcelOnline adapter | `packages/graph` | reads/writes the forwarder's Excel rate engine via MS Graph — **swap-in at Week-6 gate** | 1B (gated) |
| **MS Graph wrapper** | `packages/graph` | Outlook (read inbound, create draft, send) + Excel Online (cell read/write) | 1B |
| **Orchestration** | `packages/orchestration` | Trigger.dev v3 task: one durable run per inbound email (retries, idempotency, queue) | 1C |
| **Web app + dashboard** | `apps/web` | Next.js on Vercel: Graph webhook receiver, magic-link auth (Supabase Auth), review/approve/send UI, usage/cost views | 1C |
| **System of record** | Supabase (`quoteagent`, eu-central-1) | requests, quotes, drafts, audit_log, rate_card; Auth; RLS | 1B+ |
| **CLI** | `apps/cli` | the Phase 0 demo path; kept as a thin harness over the same core | built (P0) |

## Data flow (happy path)

1. Outlook receives a customer email → MS Graph change notification → `apps/web` webhook validates + persists a `quote_request` (status `received`) in Supabase → enqueues a Trigger.dev task.
2. Trigger.dev task runs the **agent core**: `extract` (Sonnet) → `gate` (code) → if quote: `RateEngine.price()` (Supabase or Excel adapter) → `draft` (Haiku) → `injectionGuard` (fail-closed).
3. Result persisted to Supabase (`quote`, `draft`, `audit_log` with token/cost usage). Status → `awaiting_review` (quote) or `escalated` (gate/guard).
4. Human opens the **dashboard**, reviews the draft + the deterministic quote breakdown, edits if needed, and **approves** → `apps/web` sends the reply via MS Graph; status → `sent`. The agent never auto-sends (D-10).

Escalation and prompt-injection behave exactly as in the slice (documented reasons; fail-closed), now surfaced as dashboard states rather than stdout.

## Tech choices — reasoning

- **Trigger.dev v3** for the agent run: a quote pipeline is a durable, retryable, idempotent unit of
  work with external calls (Graph, LLM) — exactly what serverless request/response handles poorly.
- **RateEngine port (D-11)** is the spine of Option C: pricing stays deterministic code behind one
  interface, so the Excel Online integration (the plan's top risk) is a swappable adapter. Ship on
  the Supabase adapter; the demo is never blocked on Excel.
- **Supabase** as system-of-record + Auth: one service for Postgres + magic-link + RLS; `service_role`
  stays server-side (Trigger.dev / web API) only, `anon` for the browser behind RLS.
- **Human-in-the-loop (D-10):** the model drafts; a person commits. Removes auto-send liability and
  is the honest answer to "what if it hallucinates a quote at 3am" — it can't send one.
- **Reuse the Phase 0 core untouched:** `packages/agents` already has the LLM seams (injectable
  client), the deterministic gate/guard, and the pricing boundary. Production wraps it; it doesn't
  rewrite it.

## Trust boundaries & security (expanded in SECURITY.md, Stage 3)

- The inbound email is **untrusted** end to end (extraction prompt framing + delimiter escaping +
  runtime injection guard, all from Phase 0).
- `service_role` key: server-side only (never in the browser bundle). Dashboard uses `anon` + RLS.
- Multi-tenant isolation (per-forwarder data) enforced by Supabase RLS — design in Stage 3.
- The agent **cannot send** without human approval (D-10); no destructive action is autonomous.

## Alternatives considered

- **A — Lean serverless (Vercel + Supabase only, no Trigger.dev, no Graph).** Fastest/cheapest, but
  no durable orchestration and abandons the wedge. Rejected: weak on the production-async learning
  goal and the "operate your Excel" positioning.
- **B — Full event pipeline with Excel Online load-bearing.** Most faithful to the wedge but makes
  the Week-6 risk a hard dependency. Rejected in favour of C, which is B with the rate engine behind
  a port so the same target is reached without the schedule risk.

## Phase mapping

- **1A** — define `RateEngine` port; refactor the slice's pricing behind it (StaticCard adapter). No
  behaviour change; eval stays 8/8.
- **1B** — SupabaseTable adapter + schema; MS Graph wrapper (Outlook ingest + draft); ExcelOnline
  adapter behind the **Wednesday-Week-6 POC gate** (fallback = stay on Supabase adapter, documented here).
- **1C** — Next.js dashboard + magic-link auth + Trigger.dev wiring + monitoring + landing/case-study.

## Open questions (resolve in SPEC / Stage 2)

- Email ingest: live Graph webhook vs scheduled poll for the demo (rate-limit + abuse surface).
- Rate-card schema in Supabase: columns mirroring the static card (base/surcharge/fee), versioned.
- Multi-tenant model: single forwarder for the demo, or schema-ready for many from day one?
- Outbound send in the public demo: real send vs simulated "sent" (likely simulated — no real
  customer inboxes). Decide in SPEC.
