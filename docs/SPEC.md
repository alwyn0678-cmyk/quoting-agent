# SPEC.md — Production end-to-end (Phase 1+)

> Expands `SLICE.md` into full flows + data model + interfaces for Option C (ARCHITECTURE.md),
> resolving the four open questions (DECISION_LOG D-13…D-16). The Phase 0 agent core
> (`extract → gate → draft → injection guard`) is reused unchanged; this spec is the plumbing
> around it. Acceptance criteria are written as pass/fail tests, same discipline as the slice.

## Actors & states
- **Reviewer** (forwarder ops): reviews/edits/approves drafts in the dashboard. Belongs to one tenant.
- **System**: poll ingest + Trigger.dev agent run.
- **quote_request status:** `received → processing → awaiting_review → sent` (happy path) or
  `received → processing → escalated` (gate/guard) or `…→ error`.

## Flow 1 — Ingest (scheduled poll, D-13)
1. A Trigger.dev **scheduled task** (e.g. every 5 min) calls MS Graph to list messages in the
   watched mailbox newer than a stored **cursor** (`receivedDateTime`/delta token per tenant).
2. **Dedup** by Graph message id (unique index); already-seen messages are skipped.
3. For each new message → insert `quote_request` (`tenant_id`, `source='poll'`, raw from/subject/body,
   status `received`) → enqueue the agent task. Advance the cursor.
- **Public-demo path:** the dashboard also accepts **paste-an-email** or **pick-a-sample**
  (`source='paste'|'sample'`), inserting an identical `quote_request`. The public demo does **not**
  poll a real inbox; polling is demonstrated against a controlled test mailbox.

## Flow 2 — Agent run (Trigger.dev task, one durable run per request)
1. status → `processing`. Run the Phase 0 core: `extract` (Sonnet) → `gate` (code) → if quote:
   `RateEngine.price()` → `draft` (Haiku) → `injectionGuard` (fail-closed).
2. Persist: `quote` (with snapshot, below) + `draft` + `audit_log` (model, tokens, est_cost,
   injection_flag). status → `awaiting_review` (quote) or `escalated` (reason shown).
3. Retries/idempotency are Trigger.dev's; re-running a request is safe (upsert by request id).

## Flow 3 — Review & simulated send (HITL, D-10 + D-14)
1. Reviewer opens the request: sees extraction, the **itemised deterministic quote breakdown**, and
   the draft. Can **edit** the draft body.
2. **Approve** → status → `sent`, record `simulated_sent_at` + intended recipient. **No Graph send
   call exists in this path** — the UI shows a clear **"SIMULATED SEND"** badge. (Optional richer
   touch: create a real Outlook *draft* via Graph, never sent.)
3. Escalated/injection requests show the reason and **no draft to send**; reviewer handles manually.

## Data model (Supabase, EU; every table carries `tenant_id` + RLS, D-15)
- **tenants**(`id`, `name`) — one seeded row for the demo.
- **rate_cards**(`id`, `tenant_id`, `lane`, `version`, `validity_through`, `is_active`, `created_at`).
- **rate_card_lines**(`id`, `rate_card_id`, `kind` ∈ {`base`,`surcharge_per_container`,`per_shipment_fee`},
  `code`, `container_type` nullable, `amount` int EUR) — mirrors the Phase 0 static card (D-16).
- **quote_requests**(`id`, `tenant_id`, `source`, `from`, `subject`, `body`, `graph_message_id` nullable
  unique, `status`, `created_at`).
- **quotes**(`id`, `request_id`, `tenant_id`, `rate_card_version`, `container_type`, `container_qty`,
  `all_in_total`, **`breakdown_snapshot` jsonb** (immutable copy of the priced line items),
  `validity_through`, `created_at`) — **snapshot makes historical quotes reproducible even if a rate
  version is later edited (D-16).**
- **drafts**(`id`, `request_id`, `tenant_id`, `subject`, `body`, `edited_body` nullable, `status`,
  `simulated_sent_at` nullable).
- **audit_log**(`id`, `tenant_id`, `request_id`, `event`, `model`, `input_tokens`, `output_tokens`,
  `est_cost_usd`, `injection_flag`, `created_at`).
- **RLS:** every table has policies restricting rows to the caller's tenant (`tenant_id = auth tenant`).
  Active with one tenant from day one. `service_role` (server/Trigger.dev) bypasses RLS; the browser
  uses `anon` + RLS only.

## Interfaces
```ts
// The seam (DECISION_LOG D-11). Phase 0's priceQuote() is the StaticCard adapter.
interface RateEngine { price(req: PriceRequest): Promise<RateQuote>; }

// Adapters:
//  StaticCard   — in-repo card (Phase 0; tests + fallback)            [built]
//  SupabaseTable— reads active rate_card + lines for {tenant, lane}   [1B, shippable]
//  ExcelOnline  — reads the forwarder's Excel via MS Graph            [1B, gated Week 6]
```
The orchestration injects the chosen adapter; the agent core is unaware which one it is. `RateQuote`
is unchanged from the slice; the SupabaseTable adapter must reproduce the slice's totals from rows.

## Acceptance criteria (pass/fail; implemented across 1A–1C)
- **AC-1 Ingest dedup:** the same Graph message id, polled twice, yields exactly one `quote_request`.
- **AC-2 Pipeline parity:** the golden-set fixtures, run through the production pipeline on the
  **SupabaseTable** adapter, still score ≥6/8 (injection must-pass) — same totals as the slice.
- **AC-3 RateEngine port:** swapping StaticCard↔SupabaseTable produces identical `RateQuote`s for the
  same request (adapter parity test).
- **AC-4 Reproducibility:** editing/superseding a rate version does **not** change an existing quote
  (it reads its `breakdown_snapshot`).
- **AC-5 Tenant isolation:** a reviewer authenticated to tenant A cannot read tenant B's rows (RLS).
- **AC-6 Approval required:** status reaches `sent` **only** via an explicit approve action; no path
  sends without it.
- **AC-7 Simulated send:** approving sets `simulated_sent_at` and makes **zero** Graph send calls
  (asserted by a mocked Graph client that fails the test if `send` is invoked).
- **AC-8 Escalation/injection surfaced:** escalated requests show the reason and expose no
  send action; the canary/price guards from the slice still hold end to end.

## Out of scope (restate)
Real send; multi-mode/lane; real customer data; autonomous send; billing; admin/tenant-management UI;
live Graph webhooks. Excel Online adapter is gated (Week-6 POC; fallback = SupabaseTable).

## Deferred to later Stage 1+/2/3 docs
MS Graph app registration + permissions + auth-to-tenant mapping (CONTEXT.md, Stage 2); action
whitelist / kill switch / HITL rules (AUTONOMY.md, Stage 2); full threat model + RLS policy detail
(SECURITY.md, Stage 3); monitoring/alerts/cost caps (MONITORING.md, Stage 3); full TESTING_PLAN +
expanded EVALS (Stage 3).
