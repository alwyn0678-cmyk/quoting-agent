# DECISION_LOG.md

Load-bearing product + architecture decisions, newest first. Each: **decision · rationale · status**.
Seeded with carried-over decisions from the canonical plan, Phase 0 learnings, and Stage 1 choices.

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
