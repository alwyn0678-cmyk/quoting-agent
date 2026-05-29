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

Lane: Rotterdam (NLRTM) → New York (USNYC), FCL ocean. Currency EUR. Rate-card version `2026-06-v1`,
`validity_through = 2026-06-30`.

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

## B. Pricing structure (STRUCTURAL — modelling choices that may not match practice)

| # | Claim | Source | How to verify |
|---|---|---|---|
| B1 | A quote = base ocean freight + per-container surcharges + per-shipment fees, summed to one all-in total | STRUCTURAL | Confirm forwarders quote an itemised base+surcharge structure for FCL |
| B2 | BAF, THC (both ends), ISPS are charged **per container**; doc fee + export customs are **per shipment** | STRUCTURAL | Verify which charges scale per-container vs per-shipment |
| B3 | All amounts are whole EUR (no cents, no FX) | STRUCTURAL/INVENTED | Real quotes may carry cents and currency conversion; Phase 0 ignores FX deliberately |
| B4 | A rate card has a single flat validity window | STRUCTURAL | Real rates vary by sailing date, carrier, contract vs spot |
| B5 | No margin/markup modelled — the "rate" is the customer-facing price | STRUCTURAL | Forwarders add margin; out of Phase 0 scope |

## C. Lane / scope / mapping (STRUCTURAL + VERIFY)

| # | Claim | Source | How to verify |
|---|---|---|---|
| C1 | "Rotterdam" → UN/LOCODE `NLRTM`; "New York" → `USNYC` | VERIFY | UN/LOCODE registry (these codes are real; the *mapping from free-text* is the assumption) |
| C2 | Quote is **port-to-port** (not door-to-door); incoterm affects what's included but Phase 0 prices port-to-port regardless | STRUCTURAL | Confirm with a forwarder; door/door changes the cost basis |
| C3 | Container types of interest are 20GP, 40GP, 40HC | STRUCTURAL | Reasonable for trans-Atlantic FCL; confirm 40HC dominance |
| C4 | Only FCL ocean is in scope; LCL/air/rail → escalate | Plan decision | n/a (scope choice, not a domain fact) |

## D. "What a typical quote email looks like" (INVENTED)

| # | Claim | Source | How to verify |
|---|---|---|---|
| D1 | A forwarder customer emails free-text requests naming origin, destination, container type/qty, sometimes incoterm/commodity/ready-date | INVENTED | Collect real anonymised quote-request emails from a forwarder |
| D2 | Requests routinely omit fields (so escalation is realistic, not a strawman) | INVENTED | as D1 |
| D3 | Emails carry noise (signatures, quoted threads, pleasantries) the extractor must ignore | INVENTED | as D1 |
| D4 | Linkport Forwarders BV is a fictional Rotterdam SMB; its reply tone/branding is invented | INVENTED | n/a (fictional tenant) |

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
