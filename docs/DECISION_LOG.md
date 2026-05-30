# DECISION_LOG.md

Load-bearing product + architecture decisions, newest first. Each: **decision · rationale · status**.
Seeded with carried-over decisions from the canonical plan, Phase 0 learnings, and Stage 1 choices.

## Phase 1G — scoped RAG (Q3) (2026-05-30)

- **D-26 · RAG grounds ONLY the drafted reply prose, never the price; over an authored, committed,
  server-side-only corpus, via Gemini Embedding 2 (768-dim) + Supabase pgvector.** · The retrieval
  query is built from engine-trusted structured fields (surcharge/fee codes, lane, container) plus an
  allowlist-normalized incoterm — never the raw email. The agent prices first, then retrieves, then
  drafts; `verifyDraftStatesTotal` + the canary guard run after, unchanged, so retrieval is
  structurally incapable of moving a number. The corpus is written by an offline indexer and read by
  the agent, both as `service_role` (`knowledge_chunks` grants no DML/SELECT to browser roles — a
  poisoned-corpus injection channel that Gate-4 caught and closed). Env-gated stub-safe: no key ⇒
  `EmptyRetriever` ⇒ today's ungrounded behaviour, byte-identical. · *The point is knowing when NOT to
  use RAG: pricing must stay deterministic engine code; only the human-facing explanation is grounded.
  Demonstrates the trusted/untrusted boundary as the load-bearing design idea, not the embedding tech.*
  · **Accepted; live index/eval deferred to the end-of-project batch (needs `GEMINI_API_KEY` + Supabase).**

## Phase 1F — serious Excel rate sheet (Q2) (2026-05-30)

- **D-25 · The Excel rate sheet is the human-editable source of truth, imported OFFLINE into Supabase
  (runtime pricing unchanged); the demo lane NLRTM-USNYC is held byte-identical to the seed/StaticCard;
  45HC is added to the rate ENGINE only, with the extraction enum deliberately NOT extended.** ·
  *A real, committed multi-lane `.xlsx` (3 lanes) + a pure `parseRateSheet` (exceljs-free, the tested
  core) + an exceljs reader + an idempotent importer (upsert by `(tenant,lane,version)`, reusing the
  seeded card id). Excel is where a forwarder swaps in their own rates; the runtime keeps reading
  Supabase, so AC-3/AC-4/RLS are untouched. Parity (NLRTM-USNYC byte-identical) turns the importer into
  a correctness proof — the round-trip test asserts `assembleRateCard(NLRTM-USNYC) === RATE_CARD` and
  6930/2770/3520/9890 from the real workbook (codex independently confirmed). Richness (45HC, CAF, PSS,
  CONGESTION) lives in the NEW lanes (NLRTM-USLAX, DEHAM-USNYC), so no golden is re-derived. 45HC is a
  backward-compatible engine extension (`rateContainerTypeSchema` + a `Partial` base map + a missing-base
  guard refusing `out_of_scope_container`, never `NaN`). Gate-4 reconciliation: the extraction enum is
  deliberately decoupled from the engine's priceable set and kept to the demo lane's quotable
  `{20GP,40GP,40HC}` — extending it broke the gate's "quote ⇒ priceable" invariant (a 45HC extraction on
  the demo lane would reach `priceQuote` and throw); decoupling restores it (45HC demo request → UNKNOWN →
  escalation). Parser hardened to fail-fast (integer-only amounts/sorts; base⇔container by kind). exceljs
  is a devDep confined to the reader/scripts/tests — never in the agent/app bundle.* · **Pending live
  `rates:import` run + sign-off (Alwyn).**

## Phase 1D — live MS Graph mail poll (2026-05-30)

- **D-24 · The live MS Graph transport is read-only (`Mail.Read`), client-credentials, folder-scoped,
  behind the existing `MailboxReader` port; the poll selects live-vs-stub by env (`hasGraphEnv`).** ·
  *Going live = implement `GraphFetchTransport` (client-credentials token + `fetch`) and point
  `OutlookMailbox` at a `mailFolder` — the `MailboxReader` port + the whole downstream pipeline are
  unchanged, so the provider is swappable (a Gmail sibling is future, zero-rework). Scope A is read-only
  BY PERMISSION (no `Mail.Send`/`Mail.ReadWrite`, no send method) and blast-radius-limited to one mailbox
  via an Exchange Application Access Policy. Reconciliation of codex Gate-4: APPLIED `folderId`
  URL-encoding, the `Prefer:text` body header (the agent extracts from plain text, not HTML), and
  token-response validation. REBUTTED four findings — (a) encoding `userId`: pre-existing interpolation,
  our UPN is `@`-only (allowed in Graph path segments per RFC 3986), and encoding `@` breaks established
  tests + exceeds this change's surgical scope; (b) sanitizing error bodies: AAD/Graph errors carry error
  CODES, never our secret/token, and the body is diagnostic — a single-tenant demo surfaces it
  deliberately (future hardening if multi-tenant/prod); (c) the smoke script printing sender/subject IS
  its purpose (AC-G5 verification), not a prod log; (d) a poll injection seam is YAGNI — `pollMailbox` is
  already injectable and tested with `FakeMailbox`, and the trigger task is thin glue.* ·
  **Pending live AC-G5 + sign-off (Alwyn).**

## Phase 1C — live layer (Trigger.dev wiring) (2026-05-29)

- **D-23 · The autonomous loop is wired live as a self-contained Trigger.dev v4 project
  (`packages/trigger`, own install root, excluded from the root typecheck), the stub mailbox sits at the
  real `GraphTransport` seam, and the durable run persists through ONE atomic RPC.** · *Four load-bearing
  choices: (1) `packages/trigger` declares only `@trigger.dev/*` — NOT `@supabase`/`@anthropic` — so there
  is a single `@supabase/supabase-js` copy and no D-19 type clash; the tasks import sibling packages +
  shared deps via the monorepo root install (proven by the dev bundle/run). codex flagged that a STANDALONE
  install could fail; rebutted — it is not independently installable by design, and a hardened prod deploy
  uses a bundler-external, not a duplicate dep. (2) The stub is a `StubGraphTransport` wrapped by the REAL
  `OutlookMailbox`, so going live = replace the transport only. (3) `persist_run_outcome()` (migration 0009)
  replaces the prior 4-call save/complete/log sequence: insert-once quote+draft + first-writer status flip +
  usage-on-the-win in ONE transaction, eliminating the partial-crash windows codex P1-b found (orphan
  quote/draft, or a terminal row with no usage). (4) The inbound dedup key is now `(tenant_id,
  graph_message_id)` (migration 0008) — a global key (codex P1-a) breaks tenant isolation. Dev runs load
  secrets via `--env-file ../../.env` (the gitignored root env); the service_role key never reaches a
  browser.* · **Accepted (Alwyn).**

## Phase 1C — autonomous ingest (hermetic) (2026-05-29)

- **D-22 · The durable agent-run is claim-based: load+claim (`received`→`processing`) scoped to the
  tenant → run → insert-once persist → complete (`processing`→terminal, first-writer-wins).** · *Makes
  the run self-sufficient for tenant safety (it never trusts a caller's row) and idempotent under
  Trigger.dev retries + LLM nondeterminism — a retry after success re-runs nothing, so the outcome
  can't flip `awaiting_review`↔`escalated` (codex Gate-4 #1/#2). The poll re-enqueues only `received`,
  so an in-flight run isn't double-triggered (#3). Crash-recovery of a stuck `processing` row (a
  `claimed_at` lease + a Trigger.dev per-request concurrency key) is deferred to the live layer.* ·
  **Accepted.**

## Phase 1C — reviewer surface (2026-05-29)

- **D-21 · Phase 1C boundary was split: the reviewer surface (1C.3–1C.6) is audited + merged ahead of
  the autonomous ingest (1C.1/1C.2).** · *1C.1/1C.2 (Trigger.dev poll + durable agent run) require a
  Trigger.dev project + a live MS Graph app registration — account actions outside the codebase. The
  dashboard, approve→simulated-send, safe-state UX, and observability are complete, proven, and
  independently shippable; gating their merge on external account setup adds no value. The autonomous
  ingest becomes its own phase with its own audit gate.* · **Accepted (Alwyn).**
- **D-20 · "Sent" is a DATABASE invariant, not a per-role grant.** A BEFORE UPDATE trigger
  (`enforce_sent_via_approve`, migration 0006) blocks any transition into `status='sent'` unless a
  one-shot transaction flag is set — and ONLY `approve_request()` sets it. · *Grants alone made "sent
  only via approve" true only for `authenticated`; `service_role` bypasses RLS and holds DML (codex
  Gate-4 P1). The trigger makes it hold for **all** roles, and structurally enforces the HITL rule that
  the autonomous run (1C.2) can never auto-send.* · **Accepted.**
- **D-19 · The reviewer dashboard is a self-contained nested Next.js 16 app (`apps/web`, folders not
  workspaces); auth = magic-link (PKCE) via `@supabase/ssr`; the shared libs are typed against narrow
  structural client interfaces, not the concrete `SupabaseClient`.** · *The nested install keeps the
  root (agents/CLI/evals/vitest) untouched but introduces a second `@supabase/supabase-js` copy, which
  split the `SupabaseClient` type identity and broke the root typecheck. Depending only on the capability
  used (`from/select/order`, `rpc`) removes the supabase-js type dependency from the libs entirely —
  immune to dependency duplication, and trivially fakeable. Tenant scoping stays in RLS (browser uses
  only the `NEXT_PUBLIC_` anon key + session); the `service_role` key never reaches the client.* ·
  **Accepted.**

## Phase 1B — implementation (2026-05-29)

- **D-18 · Browser (anon/authenticated) is READ-ONLY in 1B; `profiles` is never writable by
  `authenticated`; quote snapshots are insert-once.** · *Least privilege: `auth_tenant_id()` trusts
  `profiles`, so a writable profile = a tenant-escalation hole (codex Gate-4 P1); and a blanket DML
  grant would let the browser mutate the "immutable" snapshot. Writes (paste request, approve draft)
  arrive in 1C behind narrow per-operation grants / service-role server actions.* · **Accepted.**
- **D-17 · ExcelOnline adapter built hermetically; the LIVE Excel POC stays gated at Week-6;
  SupabaseTable is the shipped engine.** The adapter logic (read workbook cells → assemble RateCard
  → the shared `priceQuote()`) is implemented and proven over a fake transport (AC-3 parity with the
  StaticCard + P-EXCEL-RO read-only). The live Excel-via-Graph transport + client-credentials auth,
  and the swap-in-vs-fallback decision, are deferred to 1C / the Wednesday-Week-6 POC. · *Neutralises
  the plan's top schedule risk (D-11/D-12): the demo ships on SupabaseTable regardless, and Excel
  swaps in behind the same `RateEngine` port only if the POC passes — never load-bearing.* ·
  **Accepted.**

## Stage 1 — Specification (2026-05-29)

- **D-16 · Versioned rate cards; quotes snapshot their breakdown.** `rate_cards` are versioned;
  each `quote` stores an immutable `breakdown_snapshot` (jsonb) + the `rate_card_version`. · *Rate
  changes must not alter historical quotes; snapshot guarantees reproducibility even if a version
  row is later edited.* · **Accepted.**
- **D-15 · Single-tenant demo, with a `tenant_id` column AND RLS from day one.** · *Design-for-change
  seam without a future migration; RLS keyed on `tenant_id` makes isolation real, not cosmetic.* ·
  **Accepted.**
- **D-14 · Outbound is a labelled SIMULATED send — never a real Graph send.** No `send` call exists
  in the approve path; UI shows a "SIMULATED SEND" badge. · *No real customer inboxes; eliminates the
  worst-case (emailing a real person). Optional: create a real Outlook draft, never sent.* · **Accepted.**
- **D-13 · Email ingest = scheduled poll (Trigger.dev), not a webhook.** Poll with a cursor + dedup
  by Graph message id. The public demo uses paste/sample input; polling runs against a controlled
  test mailbox. · *Smaller attack surface, no public ingress or subscription-renewal cron.* · **Accepted.**

- **D-12 · Production architecture = Option C (hybrid + swappable RateEngine port).** Full pipeline
  (Trigger.dev v3 + MS Graph/Outlook + Supabase + Next.js dashboard + magic-link) with pricing
  behind a `RateEngine` interface. · *Keeps the "operate your existing Excel" wedge as the target
  while making the Excel Online dependency swappable, neutralising the plan's top schedule risk.* ·
  **Accepted.** (Alternatives A/B considered — see ARCHITECTURE.md.)
- **D-11 · `RateEngine` is a port with adapters: StaticCard → SupabaseTable → ExcelOnline.** The
  Phase 0 `priceQuote()` is the seam. Ship end-to-end on the Supabase adapter; add the Excel Online
  (MS Graph) adapter at the Week-6 POC gate. · *Pricing stays deterministic code; the riskiest
  integration becomes a swappable implementation, not a load-bearing one.* · **Accepted.**
- **D-10 · Human-in-the-loop: drafts are approved in the dashboard before any send.** The agent
  never auto-sends. · *Trust + liability; mirrors the slice's escalation model — the model drafts,
  a human commits.* · **Accepted.**

## Phase 0 — learnings (2026-05-29)

- **D-09 · Opus 4.8 deprecates `temperature`; we omit it.** · *Determinism rests on structured
  output + tolerant/pass-band assertions, never sampling. Surfaced on the first live eval.* ·
  **Accepted.**
- **D-08 · Safety guards run at runtime, not eval-only.** Draft-total fidelity (T10) + canary
  redaction are enforced inside `runAgent`, fail-closed. · *codex Gate-4 found these were only in
  the scorer; the live agent must guarantee them.* · **Accepted.**
- **D-07 · Model routing.** Opus 4.8 in Phase 0; Phase 1+ route **Sonnet 4.6 (extraction) / Haiku
  4.5 (drafting)**, single-model fallback Sonnet. · *Extraction is security/ambiguity-sensitive;
  drafting is easy and backstopped by deterministic checks.* · **Accepted; implement Phase 1+.**

## Carried-over — pre-Phase-0 (brainstorm + grill)

- **D-06 · Supabase account: `carlyshartin@gmail.com` for QuoteAgent ONLY**; Northscale
  (`info@northscale.studio`) stays the main/default account. · **Accepted** (project `quoteagent`,
  region `eu-central-1`, provisioned 2026-05-29).
- **D-05 · Orchestration = Trigger.dev v3** (not n8n). · **Accepted.**
- **D-04 · Scope v1 = ONE mode + ONE lane: FCL ocean, Rotterdam→New York.** · **Accepted.**
- **D-03 · Mock realism seeded from public indices (Drewry / Freightos FBX / Xeneta) but treated as
  ASSUMPTIONS, not facts.** · *Domain humility — see ASSUMPTIONS.md.* · **Accepted.**
- **D-02 · Success metric = Capability Articulation** (explain every component to a senior AI hiring
  manager without hand-waving). · **Accepted.**
- **D-01 · Repo public MIT from week 1; demo public behind a magic-link gate.** · **Accepted.**
