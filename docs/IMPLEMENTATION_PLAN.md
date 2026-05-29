# IMPLEMENTATION_PLAN.md — Phase 1+ build (1A · 1B · 1C)

> One task per iteration, smallest safe change, each task names the **single test** that proves it
> done, then **STOP** for review — the same discipline as `SLICE_PLAN.md`, now over the production
> architecture (ARCHITECTURE.md, Option C). Proving tests are SPEC's **AC-1…AC-8**, the Phase 0
> tests reused (**T-series**), and a few task-local tests (**P-…**) defined at the bottom. Do not
> start a task until this plan is approved; do not pull a later task's scope into an earlier one.

## Tooling (carried from Stage 1; confirm at 1A.1)
Node 20+/TypeScript/Vitest/Zod as in Phase 0. **Supabase** (Postgres + Auth + RLS, eu-central-1),
**Trigger.dev v3** (poll + agent run), **Next.js on Vercel** (dashboard), **MS Graph** (Outlook
read + draft-create, Excel read). **Model routing (D-07): Sonnet 4.6 extraction / Haiku 4.5
drafting**, single-model fallback Sonnet — bumping a model id re-runs the golden set (logged, never
silent). The agent core in `packages/agents` is **reused unchanged**; these tasks build around it.

---

## Phase 1A — RateEngine port (no behaviour change; live eval stays ≥6/8, unchanged from Phase 0)

| # | Task (smallest safe change) | Proving test | Stop-after deliverable |
|---|---|---|---|
| **1A.1** | Define `interface RateEngine { price(req): Promise<RateQuote> }` + `PriceRequest` in `packages/agents`. No caller changes yet. | `tsc --noEmit` clean **and** existing **70/70** offline tests still green (zero behaviour change). | The port type. |
| **1A.2** | Refactor Phase 0 `priceQuote()` into a `StaticCardRateEngine` implementing the port; `runAgent` calls an **injected** engine (default = StaticCard). | **P-1A.2** refactor-equivalence (the offline pricing tests T4/T5 + full suite pass unchanged against `StaticCardRateEngine`; no `RateQuote` differs from Phase 0) **and live eval ≥6/8** (T12 must-pass), unchanged. *(AC-3 needs a second adapter — it is reserved for 1B.3/1B.6.)* | Pricing behind the seam, behaviour identical. |

---

## Phase 1B — Supabase adapter + schema + Graph wrapper + Excel (gated)

| # | Task | Proving test | Stop-after deliverable |
|---|---|---|---|
| **1B.1** | Supabase schema migration: all SPEC tables + RLS policies + `auth_tenant_id()` (SECURITY DEFINER) + `profiles` direct policy. | **AC-5** (a reviewer in tenant A cannot read tenant B's rows). | The multi-tenant schema; isolation real, not cosmetic. |
| **1B.2** | Seed the Linkport rate card as rows (CONTEXT.md schema → `ASSUMPTIONS` A1–A9). | **P-1B.2** seed-sum: the 9 lines yield base + €860/container + €110/shipment, and the four golden requests recompute to 6,930 / 2,770 / 9,890 / 3,520. | The static card, now as rows. |
| **1B.3** | `SupabaseTableRateEngine` adapter: read the active card + lines for {tenant, lane}, compute by the CONTEXT formula. | **AC-3** (StaticCard ↔ SupabaseTable identical) **and AC-2** (golden set ≥6/8 through the production pipeline on this adapter). | The shippable production rate engine. |
| **1B.4** | Persist quote snapshots: `quotes` store `breakdown_snapshot` + `rate_card_version` on create; reads use the snapshot. | **AC-4** (editing/superseding a rate version does **not** change an existing quote). | Reproducible historical quotes. |
| **1B.5** | MS Graph wrapper: Outlook **read** (list by cursor) + **create-draft** (no send scope requested). | **AC-7** mechanism (a mocked Graph client fails the test if `send` is invoked) **and** a unit asserting the wrapper exposes **no** send method **and P-1B.5** (a list-by-cursor unit: the wrapper returns only messages newer than the cursor and advances it). | Ingest-read + draft-create, send-free, both halves proven. |
| **1B.6** | ExcelOnline adapter **behind the Wednesday-Week-6 POC gate**: read cells → `RateQuote` on the seed card. | **AC-3** parity with StaticCard on the seed card **and P-EXCEL-RO** (the adapter/wrapper exposes **no** Excel-write method — R7). **Gated:** if the POC slips, fallback = stay on SupabaseTable, **logged in DECISION_LOG** (not silent). | Swap-in Excel engine **or** a recorded fallback decision. |

---

## Phase 1C — orchestration + dashboard + auth + observability

| # | Task | Proving test | Stop-after deliverable |
|---|---|---|---|
| **1C.1** | Trigger.dev **scheduled poll**: cursor + dedup by `graph_message_id` + re-enqueue stranded `received` requests (AUTONOMY W5). | **AC-1** (the same message id polled twice → exactly one `quote_request`) **and P-TENANT** (the poll, configured for tenant A, never inserts a row carrying another `tenant_id` — the `service_role` path bypasses RLS, so this is the control). | Durable ingest. |
| **1C.2** | Trigger.dev **agent-run task**: one durable run per request, idempotent **upsert** on the unique `request_id`. | **P-1C.2** retry-idempotency (re-running yields exactly one quote + one draft, never duplicates) **and P-TENANT** (the run, scoped to the request's tenant, never reads or writes another tenant's rows). | Replay-safe, tenant-scoped agent run. |
| **1C.3** | Next.js dashboard + magic-link auth (Supabase Auth) + `profiles`→tenant; list requests, show extraction + **itemised breakdown** + draft. | **AC-5** end-to-end (browser `anon`+RLS surfaces only the caller's tenant) **and P-1C.3** (render: the itemised breakdown shown equals `quote.breakdown_snapshot`, and extraction + draft render). | The reviewer surface. |
| **1C.4** | Approve → **simulated send**: status `sent`, `simulated_sent_at`, "SIMULATED SEND" badge, zero Graph send. | **AC-6** (sent only via Approve) **and AC-7** (zero send calls in the approve path). | The HITL commit, send-free. |
| **1C.5** | Surface escalations + flagged injection: reason shown with **no send action**; `injection_flag` badge (quote-and-flag). | **AC-8** (escalations show the reason and expose no send; canary/price guards hold end-to-end) + **fixture-07** parity. | The safe-state UX. |
| **1C.6** | Observability: surface `audit_log` token/cost in a usage view. | **P-1C.6** usage rows well-formed (`model`, `input/output_tokens`, `est_cost_usd`) on **both** quote and escalate paths (T13 parity, Phase-1 level). | The observability evidence for the learning goal. |

---

## Task-local proving tests (extend SPEC's AC catalog; defined here, not re-opened in SPEC)
- **P-1A.2** — refactor-equivalence: no `RateQuote` differs before vs after the `StaticCardRateEngine`
  port (T4/T5 + full offline suite green; AC-3 can't run yet — only one adapter exists).
- **P-1B.2** — seed-sum / card-as-rows parity (above).
- **P-1B.5** — Outlook read-by-cursor: the wrapper returns only messages newer than the cursor and
  advances it (proves the read half of 1B.5, not just the send-free half).
- **P-EXCEL-RO** — the Graph/Excel wrapper + ExcelOnline adapter expose **no** Excel-write method
  (the enforcement behind refuse-list R7, mirroring R1's "no send method").
- **P-TENANT** — `service_role` tenant-scoping: the poll/run code configured for tenant A can never
  read or write a row carrying another `tenant_id`. **This is a different control from AC-5**, which
  proves RLS on the *browser* path; the autonomous path bypasses RLS (SPEC data-model note), so this
  test guards it. Seed **two** tenants — one cannot catch a leak.
- **P-1C.2** — agent-run retry-idempotency (a Trigger.dev retry upserts, never duplicates).
- **P-1C.3** — dashboard render: the itemised breakdown shown equals `quote.breakdown_snapshot`;
  extraction + draft render (proves the UI half of 1C.3, not just AC-5 isolation).
- **P-1C.6** — usage object well-formed on both paths (the Phase-1 form of T13).

Every other task maps to an existing **AC-1…AC-8** (SPEC) or a reused **T-series** (Phase 0) test —
no behaviour is asserted by anything weaker than one pass/fail test.

## Ordering rationale
- **1A before everything:** the port is a pure refactor; proving it is behaviour-equivalent
  (**P-1A.2**) with the live eval still **≥6/8** means every later adapter is swapped into an
  unchanged, already-verified core.
- **1B.1 → 1B.2 → 1B.3:** schema + isolation, then rows, then the adapter that reads them — each
  depends on the prior. **1B.4** (snapshot) follows the adapter that produces the breakdown.
- **1B.6 (Excel) is last in 1B and gated** — the plan's top risk (D-11/D-12) is never load-bearing;
  the demo ships on the Supabase adapter regardless of the POC outcome.
- **1C** wires already-proven units in run order (ingest → run → review → approve → safe-state UX →
  observability). The **human gate (1C.4) lands before** the loop is declared closed — there is no
  point at which the system can reach `sent` without it.

## Iteration discipline (per task — unchanged from Phase 0)
1. One incomplete task. 2. Don't expand scope. 3. Smallest safe change. 4. Run its named test.
5. Fix only related errors (unrelated → note for the user). 6. Record files changed + tests run.
7. **Stop. User reviews.** Repeat. Each task is its own branch/commit; codex second-opinion at
phase boundaries (1A / 1B / 1C), per the per-phase audit lifecycle.

## Definition of done
- **1A:** port defined, pricing behind it, refactor-equivalent (**P-1A.2**), **live eval ≥6/8**
  unchanged from Phase 0.
- **1B:** schema + RLS isolation (AC-5), card as rows (P-1B.2), Supabase adapter at parity and
  golden-set ≥6/8 (AC-3 + AC-2), snapshots reproducible (AC-4), Graph wrapper send-free + read-proven
  (AC-7 + P-1B.5); Excel either swapped in at parity and write-free (AC-3 + P-EXCEL-RO) **or** a
  logged fallback to Supabase.
- **1C:** ingest dedup (AC-1), idempotent run (P-1C.2), **`service_role` tenant-scoping (P-TENANT)**,
  tenant-isolated **and correctly-rendered** dashboard (AC-5 + P-1C.3), approve-gated simulated send
  (AC-6 + AC-7), escalation/injection surfaced (AC-8), usage observable (P-1C.6).
- **Phase gate:** all named tests green + codex second-opinion + an `AUDIT_LOG.md` entry per phase,
  then user sign-off before the next phase — the canonical ship gate.

## Risks specific to the build (watch during execution)
- **Excel Online POC (top risk, D-11):** the Week-6 gate decides swap-in vs documented Supabase
  fallback — the port exists precisely so this is not a schedule dependency.
- **Live-eval variance on the Supabase adapter (AC-2):** pricing is deterministic, so any drift is
  in extraction/draft, caught by the ≥6/8 band + T12 must-pass — not papered over.
- **RLS recursion / leakage (AC-5):** already designed around (SECURITY DEFINER `auth_tenant_id()`);
  the migration must be tested with two seeded tenants, not one.
- **Cost (observability + K2 kill switch):** token spend is the main runaway risk since nothing
  sends; the usage view (1C.6) + the agent-run pause (AUTONOMY K2) bound it.
