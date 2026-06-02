# Design — Multi‑modal rate sheet: barge (first increment)

- **Date:** 2026‑06‑02
- **Status:** Approved (design); implementation plan pending
- **Author:** Alwyn + Claude (brainstormed)
- **Scope of this spec:** Add **barge** as a priceable mode on lane **NLRTM → DEDUI** (Rotterdam → Duisburg), and generalise the engine from "FCL‑only" to a **mode‑keyed** rate sheet so that rail, truck, and airfreight become cheap follow‑on increments. Approach A (mode‑scoped cards, reuse the pure pricing function).

## 1. Context (current state)

- Pricing is a single pure function `priceQuote(req, card)` (`packages/agents/src/rate-engine.ts`): `all_in_total = qty × (base_per_container + Σ per‑container surcharges) + Σ per‑shipment fees`. It **hard‑rejects** any `mode !== "FCL"` with `UnpriceableRequestError("out_of_scope_mode")`.
- Cards live in Supabase: `rate_cards` (id, tenant_id, version, validity_through, **lane**, is_active, created_at) + `rate_card_lines` (kind, code, container_type, amount, sort_order). The active card is fetched by **lane only** (`SupabaseRateCardSource.fetchActiveCard(tenant, lane)`), assembled into a `RateCard`, and priced by the same `priceQuote()`.
- The live pipeline constructs the engine with a **fixed `DEFAULT_LANE`** (`scripts/poll_once.ts:41`, `packages/trigger/src/trigger/run.ts:28`), so it can currently only price one lane; other lanes in the sheet (A′: USLAX, DEHAM) do not price live.
- `modeSchema` = `["FCL","LCL","AIR","RAIL","UNKNOWN"]` (no `BARGE`). `RateQuoteSchema.lane` regex `^[A-Z]{5}-[A-Z]{5}$` already accepts `NLRTM-DEDUI`; container types already include 20GP/40GP/40HC/45HC.
- **Domain humility (CLAUDE.md):** every rate/surcharge/unit added here is INVENTED and must be logged in `ASSUMPTIONS.md`; none is presented as fact.

## 2. Goal & non‑goals

**Goal:** A barge request (RTM→Duisburg, by container) is extracted as `mode = BARGE`, priced by the deterministic engine from a barge rate card (incl. the signature **Low‑Water Surcharge**), and flows through the existing quote→draft→review path unchanged. The engine is now multi‑modal: **mode is a first‑class card key**, and pricing **dispatches on a mode→basis map**.

**Non‑goals (this increment):**
- Air (per chargeable‑kg) and truck (FTL/LTL) **pricing logic** — only the dispatch seam is added; their bases refuse (`out_of_scope_mode`) until built.
- Rail — trivial follow‑on (same `per_container` basis), but not in this increment (barge‑first was chosen).
- Any dashboard/UI change.

## 3. Decision (Approach A)

Mode becomes a first‑class key on the rate card; pricing dispatches on a `pricing_basis` **derived from mode in code** (no new DB column beyond `mode`). Container‑based modes (FCL, BARGE, later RAIL) reuse the existing container math byte‑for‑byte. The genuinely different units (air `per_chargeable_kg`, truck `per_ldm`) are reserved in the map but not implemented — they slot in later without touching what we build now.

## 4. Data model

- **Migration `0013_rate_card_mode.sql`:** `alter table public.rate_cards add column if not exists mode text not null default 'FCL';` (existing rows backfill to `FCL`). The active‑card **lookup** then filters on `mode` as well as lane (code change, §6). If a partial unique index on active cards exists (e.g. one‑active‑per‑(tenant,lane)), extend it to include `mode`; otherwise no constraint change is needed — the lookup already takes the latest active row. Append‑only, idempotent.
- **`RateCard` (`rate-card.ts`) + `RateCardSource` (`rate-card-source.ts`):** carry `mode: string`. `pricing_basis` is **not stored** — derived via `MODE_BASIS: Record<string,"per_container"|"per_chargeable_kg"|"per_ldm">` (`FCL/BARGE/RAIL → per_container`; `AIR → per_chargeable_kg`; `TRUCK → per_ldm`).
- The in‑repo `RATE_CARD` constant stays FCL (Phase‑0 demo); the barge card lives in the Excel sheet → Supabase (source of truth, D‑25).

## 5. Pricing dispatch (`rate-engine.ts`)

- Replace `if (req.mode !== "FCL") throw …` with: `const basis = MODE_BASIS[req.mode]`. If `basis` is undefined → `out_of_scope_mode`. If `basis === "per_container"` → run the **existing** container math unchanged. Other bases → `out_of_scope_mode` (seam present, not implemented) with a clear "not yet built" message.
- `priceQuote` additionally asserts the fetched `card.mode === req.mode` (defence in depth) alongside the existing lane match.
- Result: barge prices through the same proven function; the `RateQuote` shape is unchanged.

## 6. Card resolution by request (engine + pipeline)

- `SupabaseRateCardSource.fetchActiveCard(tenantId, **mode**, lane)` — add `mode` to the `.eq()` filter and the select.
- `SupabaseTableRateEngine.price(req)` resolves the active card from **the request's** `mode` + lane (`${req.origin_port_code}-${req.destination_port_code}`), not a constructor constant. Constructor takes `(source, tenantId)`.
- `createSupabaseRateEngine(tenantId)` drops the `lane` arg; update call sites `scripts/poll_once.ts` and `packages/trigger/src/trigger/run.ts` (remove `DEFAULT_LANE`).
- **Intended consequence:** the USLAX/DEHAM cards already imported (A′) begin pricing live, since the engine is no longer pinned to one lane. This is a natural result of the required change, not extra scope; called out so it is intentional.

## 7. Extraction (`schemas.ts` + extraction prompt)

- Add `"BARGE"` to `modeSchema`. (AIR/RAIL/LCL already present but unpriceable.)
- Add a barge/inland‑terminal example to the extraction prompt so a Rhine‑barge request maps to `mode = BARGE`, `origin = NLRTM`, `destination = DEDUI`. The lane regex + LOCODE handling already accept this — no schema change beyond the enum.
- Unmapped mode/lane still escalates via the existing `out_of_scope_mode` / `out_of_scope_lane` reasons (HITL preserved).

## 8. Rate sheet + assumptions

- Extend the Excel workbook + scripts (`gen_rate_sheet.ts`, `parse-rate-sheet.ts`, `import_rate_sheet.ts`) with a **`mode`** column; add the barge card. `import_rate_sheet.ts` writes `rate_cards.mode`.
- **Proposed INVENTED figures** (barge NLRTM→DEDUI, EUR, per container unless noted — to be logged in `ASSUMPTIONS.md` section "Barge (NLRTM→DEDUI)", every line `INVENTED` + verification path):
  | Code | Description | Value | Notes |
  |---|---|---|---|
  | base 20GP | inland barge freight | €280 | INVENTED — verify vs a Rhine barge operator tariff / forwarder |
  | base 40GP/40HC | inland barge freight | €420 | INVENTED — verify; 40' ≥ 20' |
  | LWS | Low‑Water Surcharge (Rhine) | €95 / container | INVENTED — confirm LWS exists, is variable with water level, and rough magnitude |
  | THC_RTM_BARGE | Rotterdam inland barge terminal handling | €95 | INVENTED |
  | THC_DUI | Duisburg terminal handling | €110 | INVENTED |
  | DOC | documentation | €35 / shipment | INVENTED |
- **`DECISION_LOG`:** new entry extending **D‑04** — "scope is no longer one mode/one lane; mode is a first‑class card key; barge NLRTM‑DEDUI added; pricing dispatches on mode→basis; air/truck deferred (seam only)."

## 9. Acceptance criteria (each maps to exactly one pass/fail test)

1. **AC‑B1 — barge prices.** `priceQuote` with `mode=BARGE`, lane `NLRTM-DEDUI`, a container type and qty, against a barge card → correct `all_in_total` incl. LWS (whole‑EUR integer math). *Test:* `rate-engine` unit.
2. **AC‑B2 — unimplemented basis refuses.** `mode=AIR` (basis `per_chargeable_kg`) → `UnpriceableRequestError("out_of_scope_mode")`. *Test:* `rate-engine` unit.
3. **AC‑B3 — mode/lane guards hold.** barge on a non‑barge lane → `out_of_scope_lane`; `FCL` request against a `BARGE` card (mode mismatch) → refused. *Test:* `rate-engine` unit.
4. **AC‑B4 — extraction.** A barge request email → `mode=BARGE`, `origin=NLRTM`, `destination=DEDUI` (temp‑0, assert on normalised schema, not exact strings). *Test:* `extraction` (LLM, pass‑band).
5. **AC‑B5 — Supabase round‑trip.** A `(BARGE, NLRTM‑DEDUI)` card in `rate_cards`/`rate_card_lines` assembles and prices **identically** to the static expectation, with `mode` carried end‑to‑end. *Test:* `supabase-rate-engine` / `rate-sheet-roundtrip` (offline, mocked source).
6. **AC‑B6 — resolution by request.** A barge request and an FCL request, against the same source, resolve to **different** cards by (mode, lane). *Test:* `supabase-rate-engine` unit (mocked source).

All offline/deterministic; the one LLM step (AC‑B4) is tested at temperature 0 with a schema/pass‑band assertion, never exact‑string equality (CLAUDE.md).

## 10. Files touched

`supabase/migrations/0013_rate_card_mode.sql` (new) · `packages/agents/src/rate-engine.ts` · `rate-card.ts` · `rate-card-source.ts` · `supabase-rate-engine.ts` · `schemas.ts` (enum) · extraction prompt · `scripts/gen_rate_sheet.ts` · `parse-rate-sheet.ts` · `scripts/import_rate_sheet.ts` · `scripts/poll_once.ts` · `packages/trigger/src/trigger/run.ts` · `docs/ASSUMPTIONS.md` · `docs/DECISION_LOG.md` · tests alongside the above. **No UI change.**

## 11. Risks

- **Domain accuracy:** all barge figures INVENTED; LWS in reality is variable with Rhine water level — we model it as a flat per‑container line and say so in ASSUMPTIONS.
- **Pipeline behaviour change:** dropping `DEFAULT_LANE` changes what the live engine will price (unlocks A′ lanes). Covered by AC‑B6 + existing lane tests; flagged as intended.
- **Migration on live data:** `0013` adds a defaulted column + changes the active‑card key; idempotent and backfills existing rows to `FCL` so current FCL pricing is unaffected (regression‑guarded by the existing FCL tests).
