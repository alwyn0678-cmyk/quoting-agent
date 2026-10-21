# ASSUMPTIONS.md — domain claims are assumptions, not facts

> **Rule (from CLAUDE.md):** I am NOT a freight-pricing expert. Every rate, surcharge, incoterm
> rule, port mapping, or "what a typical quote email looks like" claim below was **generated /
> invented by the agent**, not sourced from authority. Nothing here may be stated as established
> fact anywhere in the project. Format: **claim · source · how to verify**.
>
> Maintained across all phases (NOT closed at Phase 0 end). Status legend:
> `INVENTED` = made up to make the slice run · `STRUCTURAL` = a modelling choice that may not match
> industry practice · `VERIFY` = needs a real-world check before any production claim.

## A. Rate-card figures (all INVENTED — placeholders to make the engine run)

Lane: Rotterdam (NLRTM) → New York (USNYC), FCL ocean. Currency EUR. Rate-card version `2026-10-v1`,
`validity_through = 2026-12-31` (refreshed 2026-10-21 so the demo card is current; still INVENTED).

| # | Claim | Value | Source | How to verify |
|---|---|---|---|---|
| A1 | Base ocean freight, 20GP | €1,800 / container | INVENTED | Cross-check a 2026 spot quote vs Freightos FBX (North Europe→US East Coast) / Drewry / Xeneta; interview a forwarder |
| A2 | Base ocean freight, 40GP | €2,400 / container | INVENTED | as A1 |
| A3 | Base ocean freight, 40HC | €2,550 / container | INVENTED | as A1; also verify 40HC typically prices at/above 40GP |
| A4 | BAF (Bunker Adjustment Factor) | €320 / container | INVENTED | Confirm BAF exists as a line item & rough magnitude with a forwarder / carrier tariff |
| A5 | THC origin (Rotterdam terminal handling) | €225 / container | INVENTED | Rotterdam terminal tariffs; forwarder |
| A6 | THC destination (New York terminal handling) | €290 / container | INVENTED | US East Coast terminal tariffs; forwarder |
| A7 | ISPS / security surcharge | €25 / container | INVENTED | Carrier tariff |
| A8 | Documentation / B/L fee | €65 / shipment | INVENTED | Forwarder fee schedule |
| A9 | Export customs handling (origin) | €45 / shipment | INVENTED | Forwarder fee schedule |

Resulting all-in totals used as expected values in fixtures (deterministic, integer EUR):
40HC×2 = €6,930 · 20GP×1 = €2,770 · 40GP×3 = €9,890 · 40HC×1 = €3,520. These are correct **given
the invented inputs above**; they are not real quotes.

## A′. Additional lanes (all INVENTED — the serious mock rate sheet, Q2)

Two extra lanes added to `rates/linkport-rate-sheet.xlsx` so the workbook is a realistic multi-lane
sheet. Every figure is INVENTED; a real forwarder substitutes their contracted rates and re-imports.
Rate-card version `2026-10-v1`, `validity_through = 2026-12-31` (refreshed 2026-10-21 so the demo card is current; still INVENTED), currency EUR.

**Lane NLRTM → USLAX (Rotterdam → Los Angeles), FCL ocean:**

| # | Claim | Value | Source | How to verify |
|---|---|---|---|---|
| A10 | Base 20GP | €2,200 / container | INVENTED | as A1 (Freightos/Drewry/Xeneta N. Europe→US West Coast; forwarder) |
| A11 | Base 40GP | €2,900 / container | INVENTED | as A10 |
| A12 | Base 40HC | €3,050 / container | INVENTED | as A10 |
| A13 | Base 45HC | €3,250 / container | INVENTED | as A10; also verify 45HC ≥ 40HC |
| A14 | BAF | €360 / container | INVENTED | as A4 |
| A15 | CAF (Currency Adjustment Factor) | €140 / container | INVENTED | Confirm CAF exists & magnitude with a forwarder/carrier tariff |
| A16 | THC origin (Rotterdam) | €225 / container | INVENTED | as A5 |
| A17 | THC destination (Los Angeles) | €310 / container | INVENTED | US West Coast terminal tariffs; forwarder |
| A18 | ISPS / security | €25 / container | INVENTED | as A7 |
| A19 | PSS (Peak Season Surcharge) | €200 / container | INVENTED | Confirm PSS applicability/season & magnitude |
| A20 | Documentation / B/L fee | €65 / shipment | INVENTED | as A8 |
| A21 | Export customs handling | €45 / shipment | INVENTED | as A9 |

**Lane DEHAM → USNYC (Hamburg → New York), FCL ocean:**

| # | Claim | Value | Source | How to verify |
|---|---|---|---|---|
| A22 | Base 20GP | €1,900 / container | INVENTED | as A1 |
| A23 | Base 40GP | €2,500 / container | INVENTED | as A22 |
| A24 | Base 40HC | €2,650 / container | INVENTED | as A22 |
| A25 | Base 45HC | €2,850 / container | INVENTED | as A22; verify 45HC ≥ 40HC |
| A26 | BAF | €330 / container | INVENTED | as A4 |
| A27 | THC origin (Hamburg) | €240 / container | INVENTED | Hamburg terminal tariffs; forwarder |
| A28 | THC destination (New York) | €290 / container | INVENTED | as A6 |
| A29 | ISPS / security | €25 / container | INVENTED | as A7 |
| A30 | CONGESTION surcharge | €175 / container | INVENTED | Confirm a port-congestion surcharge applies & magnitude |
| A31 | Documentation / B/L fee | €65 / shipment | INVENTED | as A8 |
| A32 | Export customs handling | €45 / shipment | INVENTED | as A9 |

Derived check (given the invented inputs): NLRTM→USLAX 45HC×1 = €4,620 (used as the AC-Q3 expected
value). Not a real quote.

## A″. Barge mode (NLRTM → DEDUI, all INVENTED)

Lane Rotterdam (NLRTM) → Duisburg (DEDUI), inland Rhine **barge**, EUR, per container. Card
`2026-10-v1`. This is the first non-FCL mode; the figures are placeholders to exercise the
multi-modal engine, not real barge rates.

| # | Item | Value | Status | How to verify |
|---|------|-------|--------|---------------|
| A33 | Base 20GP | €280 / container | INVENTED | Rhine barge operator tariff (e.g. Contargo / Danser) / forwarder |
| A34 | Base 40GP / 40HC | €420 / container | INVENTED | as A33; verify 40' ≥ 20' |
| A35 | LWS (Low-Water Surcharge) | €95 / container | INVENTED | Confirm LWS exists, is VARIABLE with Rhine water level (we model a flat line), and rough magnitude |
| A36 | THC origin (Rotterdam barge terminal) | €95 / container | INVENTED | Rotterdam inland barge terminal tariff |
| A37 | THC destination (Duisburg) | €110 / container | INVENTED | Duisburg (duisport) terminal tariff |
| A38 | DOC (documentation) | €35 / shipment | INVENTED | forwarder |

Derived check (given the invented inputs): NLRTM→DEDUI barge 40HC×1 = €755; 20GP×2 = €1,195
(used as the AC-B1 expected values). Not a real quote.

## B. Pricing structure (STRUCTURAL — modelling choices that may not match practice)

| # | Claim | Source | How to verify |
|---|---|---|---|
| B1 | A quote = base ocean freight + per-container surcharges + per-shipment fees, summed to one all-in total | STRUCTURAL | Confirm forwarders quote an itemised base+surcharge structure for FCL |
| B2 | BAF, THC (both ends), ISPS are charged **per container**; doc fee + export customs are **per shipment** | STRUCTURAL | Verify which charges scale per-container vs per-shipment |
| B3 | All amounts are whole EUR (no cents, no FX) | STRUCTURAL/INVENTED | Real quotes may carry cents and currency conversion; Phase 0 ignores FX deliberately |
| B4 | A rate card has a single flat validity window | STRUCTURAL | Real rates vary by sailing date, carrier, contract vs spot |
| B5 | No margin/markup modelled — the "rate" is the customer-facing price | STRUCTURAL | Forwarders add margin; out of Phase 0 scope |
| B6 | A card is usable through its `validity_through` date inclusive, checked against the quote date in **UTC**; the cargo-ready date is not yet considered | STRUCTURAL | Confirm whether forwarders price on quote date, cargo-ready date or sailing date, and which timezone governs validity (P1 adds valid_from/valid_to per line) |

## C. Lane / scope / mapping (STRUCTURAL + VERIFY)

| # | Claim | Source | How to verify |
|---|---|---|---|
| C1 | "Rotterdam" → UN/LOCODE `NLRTM`; "New York" → `USNYC` | VERIFY | UN/LOCODE registry (these codes are real; the *mapping from free-text* is the assumption) |
| C2 | Quote is **port-to-port** (not door-to-door); incoterm affects what's included but Phase 0 prices port-to-port regardless | STRUCTURAL | Confirm with a forwarder; door/door changes the cost basis |
| C3 | Container types of interest are 20GP, 40GP, 40HC, and 45HC (45HC added in Q2 for the new lanes; the demo NLRTM→USNYC lane prices only the first three) | STRUCTURAL | Reasonable for trans-Atlantic/Pacific FCL; confirm 40HC/45HC usage |
| C4 | Only FCL ocean is in scope; LCL/air/rail → escalate | Plan decision | n/a (scope choice, not a domain fact) |

## D. "What a typical quote email looks like" (INVENTED)

| # | Claim | Source | How to verify |
|---|---|---|---|
| D1 | A forwarder customer emails free-text requests naming origin, destination, container type/qty, sometimes incoterm/commodity/ready-date | INVENTED | Collect real anonymised quote-request emails from a forwarder |
| D2 | Requests routinely omit fields (so escalation is realistic, not a strawman) | INVENTED | as D1 |
| D3 | Emails carry noise (signatures, quoted threads, pleasantries) the extractor must ignore | INVENTED | as D1 |
| D4 | Linkport Forwarders BV is a fictional Rotterdam SMB; its reply tone/branding is invented | INVENTED | n/a (fictional tenant) |
| D5 | The Phase-1C stub mailbox corpus (packages/ingest/src/stub-transport.ts) = verbatim copies of golden fixtures 01/04 (so it inherits D1–D4); its `receivedDateTime` timestamps are fabricated, only to drive the poll cursor | INVENTED | n/a (a test stand-in; replaced by real Outlook mail when the live transport is wired) |

## E. Agent-behaviour thresholds (INVENTED defaults, to tune against fixtures)

| # | Claim | Value | Source | How to verify |
|---|---|---|---|---|
| E1 | Overall-confidence escalation threshold | 0.75 | INVENTED | Tune on the golden set; justify the chosen band in the eval write-up |
| E2 | Required fields to quote | origin, destination, mode, container_type, container_qty | STRUCTURAL | Confirm these 5 are sufficient to price an FCL quote with a forwarder |
| E3 | Token→USD cost constants for the stdout cost log | (pinned config) | VERIFY | Check against current Anthropic pricing at build time |

## F. Open verification path

- The canonical plan notes a possible freight-forwarder contact (Airwaves, listed in memory) who
  could sanity-check Section A/B/C **post-launch, for assumption-verification only** — no build
  commitment. Until then, every figure above stays labelled INVENTED.

## G. Knowledge corpus (Q3 RAG — all INVENTED / curated)

The `knowledge/*.md` corpus (surcharge & fee glossary, incoterms summaries, Linkport quoting policy,
lane/port notes) is authored content for the fictional Linkport — definitions, policy clauses, and
lane notes are written to read plausibly, NOT sourced from authority. They ground the *reply prose*
only (never the price). Verify each glossary definition against a carrier/forwarder tariff and a real
Incoterms 2020 reference; the lane/port operational notes (routing/transit) are especially invented.

| # | Claim | Source | How to verify |
|---|---|---|---|
| G1 | Surcharge/fee definitions (BAF, CAF, THC, ISPS, PSS, CONGESTION, DOC, EXPORT_CUSTOMS) | INVENTED | Carrier tariff + forwarder fee schedule |
| G2 | Incoterm summaries (FOB, CIF, EXW, DAP) | INVENTED summary | Cross-check ICC Incoterms 2020 |
| G3 | Linkport quoting policy (validity, port-to-port basis, inclusions/exclusions, booking) | INVENTED (fictional tenant) | n/a (fictional) — confirm shape with a forwarder |
| G4 | Lane/port notes (NLRTM/USNYC/USLAX/DEHAM) | INVENTED | UN/LOCODE registry; a forwarder for routing/transit |
| G5 | Gemini embedding model id `gemini-embedding-2`, 768-dim, auto-normalized; REST body uses camelCase `outputDimensionality` (Gate-4 fix #2) and encodes the task as an in-prompt instruction (no `taskType` param) | **LIVE-CONFIRMED 2026-05-31** | Verified end-to-end: `rag:index` embedded the corpus at 768-dim (the length assert did not throw) and `eval:rag` + the pgvector `match_knowledge` smoke both ranked 3/3 against the real API. The model id, 768-dim output, and camelCase request shape are confirmed; only the corpus *content* (G1–G4) remains INVENTED |

## H. Pricing core v2 (P1a) — STRUCTURAL assumptions (verify with a forwarder)

| # | Claim | Source | How to verify |
|---|---|---|---|
| H1 | Commercial rounding is **half away from zero**, once per charge line, to the currency's minor unit; totals are exact sums of lines | By analogy to VAT practice (Hoge Raad 2009 Ahold; Reg. 1103/97 Art. 5) — not freight-specific | Check a forwarder's invoicing/ERP rounding settings |
| H2 | LCL revenue tons = max(tonnes, m³) with 1 t = 1 m³ (W/M 1:1), rounded **up** to 3 dp | INVENTED convention (common in rate guides; unverified) | Carrier/co-loader LCL tariff rules |
| H3 | Stated cargo totals that differ from piece-derived totals by > 2% are a conflict | INVENTED threshold | Reviewer feedback on real emails |
| H4 | Pricing date = max(as-of, cargo-ready date); a line must be valid on both | INVENTED policy (carrier contracts may govern by ETD or gate-in) | Carrier contract terms |
| H5 | FX snapshot max age 7 days; conversion via base rates (ECB EUR-based) with one rounding | INVENTED policy | Forwarder treasury practice |
| H6 | Quote validity default 14 days, capped by every component rate's validity | INVENTED | Forwarder quote T&Cs |
| H7 | Dangerous goods / temperature control not stated = quoted as general cargo, with a visible assumption line | INVENTED policy | Forwarder practice; legal review |
| H8 | Margin applies to BUY lines only; SELL (all-in) tariffs pass through unchanged | STRUCTURAL | Forwarder pricing desk |
| H9 | Mixed-equipment offers charge shipment-level fees once and require them to be identical across lines | STRUCTURAL | Carrier contract structure |
| H10 | A 45' container counts as 2 TEU (some carriers count 2.25) | STRUCTURAL | Carrier tariff TEU rules for PER_TEU charges |
| H11 | Phrasebook translations (NL, DE, ES, PT, ZH) are correct, natural and commercially appropriate | INVENTED (written without native review) | Native-speaker review per language before customer use |
