# Spec P1a — Multimodal pricing core + ocean (FCL, LCL) + mock world

_Final revision (Claude) after Codex rounds 1–3 (35 + 25 + 15 findings, all accepted). Precedence:
§16 > §15 > earlier sections. Review log: docs/specs/2026-10-21-p1a-review-log.md._ Review log: docs/specs/2026-10-21-p1a-review-log.md. Roadmap: docs/ROADMAP.md._

## Goal
Replace the FCL-only, whole-EUR, single-lane pricing with a **deterministic, auditable, multi-currency
pricing core** that every later mode plugs into, and ship it **operational end to end** for ocean
FCL and LCL, port-to-port. Exit criteria [R1#31]:
- Production worker path (Trigger.dev, single tenant until P3) prices through the new core via the
  legacy-card adapter with **line-by-line parity** to today's engine.
- All six mock-world tenants quote end to end via CLI, demo replay and evals.
- Golden set v2 passes exactly (legacy 8 + new FCL/LCL); live run on the default model passes the gate;
  CI green after **every** commit.

## Non-goals
Air/express/road (P1b); rail/barge/door legs and composition (P1c); canonical tariff tables +
ingestion (P2); multi-tenant runtime, customer identity, roles (P3); clarification emails (P4); PDFs
(P5); tenders (P6); metrics/alerting (P7).

## Architecture
```
packages/core/            pure domain — zero I/O, no SDKs; enforced by an import-boundary test
  money/     Money (bigint minor units + ISO-4217 exponent, small allowlist), Dec (big.js wrapper,
             fixed rounding API), FX snapshot + conversion, wire codec (decimal strings)
  places/    Place, UN/LOCODE + ISO 6346 validation, equipment aliases
  request/   ShipmentRequest v2 (Zod), unit normalisation, cargo totals derivation
  tariff/    Tariff → RateLine → ChargeDef; validation (unique charge ids, PCT DAG, currency,
             bounds); matcher (partial-order specificity, ambiguity as a result)
  modes/     ModeModule registry: FCL, LCL
  pricing/   engine → PricingResult with all candidate options + receipts + trace
  margin/    MarginRule matching + application → separate sell-only adjustment lines
  gate/      ordered deterministic decision with named missing fields
  guard/     canonical-wire re-derivation, canary, draft-template check
  draft/     slot renderer (all facts rendered by code; escaped)
packages/agents/          orchestration: LLM steps, TariffSource adapters, runAgent v2
examples/mock-world/      generated + committed tenants, tariffs, FX snapshot, emails, NOTICE
```

## 1. Numbers [R1#8,9,10,16,22,35]
- **Money** = `{ minor: bigint, currency }`. Currency allowlist with exponents: EUR, USD, GBP, CNY,
  SGD, ZAR, BRL, HKD, INR (2), JPY (0). Amounts ≥ 0 in P1a (no rebates). Bounds: |minor| ≤ 10^15.
- **Dec** = thin wrapper over **big.js** (mature, dependency-free) for rates, quantities, FX and
  percentages; the wrapper exposes only the operations and rounding modes we permit. Parse from strings
  or integers only; JSON numbers from the LLM are converted with `String(n)` (shortest round-trip
  decimal, no binary error introduced) and range-checked.
- **Canonical sequence per charge line:**
  `normalize units → aggregate → chargeable quantity (rounded per mode rule) → qty × rate (exact) →
  round half-up to currency minor → apply min/max (in charge currency) → line amount`.
  Totals are exact sums. PCT_OF lines compute on rounded referenced amounts, same currency only.
- **Quantity scales:** weight kg 3 dp; volume m³ 6 dp (from cm dims); LCL revenue tons rounded **up**
  to 3 dp [ASSUMPTION]; container counts integer.
- **Wire format:** every core result has a canonical JSON form with decimal strings (no bigint, no
  floats). Comparison, hashing, canary scanning, logging, persistence and cassettes use the wire form.

## 2. Request v2 [R1#2,6,7]
```
mode: FCL | LCL | AIR | EXPRESS | FTL | LTL | DRAYAGE | RAIL | BARGE | MULTIMODAL | UNKNOWN
service: PORT_TO_PORT | DOOR_TO_PORT | PORT_TO_DOOR | DOOR_TO_DOOR | UNKNOWN
origin/destination: { raw, unlocode|null, iata|null, country|null, postcode|null }
cargo: {
  containers: [{ type_raw, iso_type|null, qty }],
  pieces: [{ qty, length_cm_each, width_cm_each, height_cm_each, weight_kg_each, stackable|null }],
  stated_total_weight_kg|null, stated_total_volume_cbm|null,
  commodity|null, dangerous_goods: true|false|null, temperature_controlled: true|false|null }
incoterm|null · ready_date|null · requester_name|null · requester_company|null
field_confidence: [{ field, confidence }] · overall_confidence · injection_detected
model_notes: { missing: string[], conflicting: string[] }      (advisory; the gate decides)
```
- Units: the model reports the units it saw (`unit_weight: kg|lb|t`, `unit_length: cm|m|in`); code
  converts. Totals are **derived in code** from pieces; a stated total that differs from the derived
  one by > 2% [ASSUMPTION] → `conflicting_cargo`.
- P1a quotes **PORT_TO_PORT only**; any other or unknown service → `out_of_scope_service`.
- `dangerous_goods = true` or `temperature_controlled = true` → `out_of_scope_cargo` (no P1a tariff
  prices them). `null` = not stated = general cargo [ASSUMPTION, logged].

## 3. Tariffs and matching [R1#1,3,4,5,15,29]
```
Tariff { id, tenant_id, version, content_hash, source, currency, valid_from, valid_to, lines[] }
RateLine { id, mode, carrier, origin: LaneEnd, destination: LaneEnd, equipment?: iso_type,
           priority, valid_from?, valid_to?, transit_days?, price_kind: BUY | SELL,
           charges: ChargeDef[], source_ref }
LaneEnd = { unlocode } | { group } | { country } | { any: true }
ChargeDef { id (unique per line), code, description, basis, rate, currency, min?, max?,
            percent_of?: charge ids (same currency, acyclic) }
basis: PER_CONTAINER | PER_TEU | PER_SHIPMENT | PER_BL | PER_WM | PER_CBM | PER_TON | PCT_OF
```
- Validation at load (fail closed, named errors): unique ids, PCT_OF references exist, are acyclic and
  same-currency; currencies allowlisted; rates/min/max bounded and ≥ 0; valid_from ≤ valid_to.
- **Pricing date** [R1#5]: `pricing_date = max(as_of, ready_date ?? as_of)`. A line is a candidate only
  if valid on `pricing_date` **and** on `as_of`. No candidate → `rate_expired` when lines exist but
  are out of date, else `out_of_scope_lane`. Option `valid_until = min(line valid_to, as_of +
  tenant.quote_validity_days)`.
- **No customer-specific lines or margins in P1a** [R1#3] — they need a trusted customer identity (P3).
- **Specificity is a partial order** [R1#4]: each lane end scores exact(3) > group(2) > country(1) >
  any(0). Line A dominates B iff A ≥ B on origin AND destination and > on at least one. Within a carrier
  and equipment type, the non-dominated set must have one member after `priority` tie-break; otherwise
  `ambiguous_rate` (escalate as `ambiguous_request` with detail).
- **Mixed equipment** [R1#1]: per carrier, resolve one line per requested ISO type; an option exists
  only if every requested type resolved. Shipment-level charges (PER_SHIPMENT/PER_BL) are charged once
  per option, from the first equipment line in canonical order (documented, tested).
- **Atomic reads** [R1#29]: the legacy Supabase adapter fetches card + lines in one RPC; every receipt
  carries the tariff content hash.

## 4. Mode modules
`ModeModule { mode, missingFields(req): Field[], quantities(req): Quantities }`
- FCL: ≥1 container line, each with resolvable ISO type and qty ≥ 1.
- LCL: pieces (all four dims + weight) **or** both stated totals; revenue tons = max(t, m³) rounded up.

## 5. Margin [R1#13,14,28]
```
MarginRule { id, match: { mode?, origin?, destination? }, kind: MARKUP_ON_BUY | GROSS_MARGIN | FLAT,
             value: Dec, currency? (FLAT), min_margin?: Money, applies_to: FREIGHT | ALL, priority }
```
- Applies only to BUY lines; SELL lines (legacy cards, all-in sell tariffs) pass through unchanged
  (legacy parity is line-by-line).
- Percent margins set each line's sell (rounded per line). A minimum margin shortfall becomes **one
  separate sell-only `MARGIN_ADJ` line** in the quote currency — no source line is mutated.
- Most specific rule wins (same partial order); unresolved tie → configuration error, fail closed.

## 6. FX [R1#11,12]
- `FxSnapshot { base, rates: { CCY: Dec } (units of CCY per 1 base), source, as_of }`, validated:
  rates > 0, no duplicates, base rate = 1, max age 7 days [ASSUMPTION] else `fx_stale`.
- Conversion via base (cross rate computed in Dec with 12 dp, then one half-up rounding to target
  minor). Same currency = identity (no receipt). Each option carries `fx_conversions[]`: { from, to,
  input_minor, rate, output_minor, source, as_of, rounding }, one per source-currency subtotal.

## 7. Output, options, receipts [R1#17,18,19]
```
PricingResult = { kind: "priced", candidates: RouteOption[], presented: string[] (option ids), trace }
              | { kind: "unpriceable", reason, detail, trace }
RouteOption { id (canonical hash), carrier, legs: [Leg], totals: { by_currency[], quote: Money },
              fx_conversions[], transit_days?, valid_until }
Leg { mode, origin, destination, quantities, lines: ChargeLine[] }
ChargeLine { id, code, description, basis, qty, rate, buy?: Money, sell: Money,
             receipt: { tariff_id, tariff_version, content_hash, rate_line_id, charge_id,
                        source_ref, margin_rule_id?, rounding } }
trace { candidates_considered, excluded: [{ rate_line_id, reason }], fx_age_days, margin_rule_ids }
```
- Ordering: quote total, then carrier, then option id (stable). `presented` = first
  `tenant.max_options` (default 3); all candidates retained for audit.
- **Cost confidentiality** [R1#19]: browser roles only ever receive a **sell-only projection**
  (`QuoteView`). Buy amounts, margin rules and the full candidate set go to a new `quote_internals`
  table with no `authenticated`/`anon` grants (service_role only). Tested in SQL.

## 8. Draft [R1#20,21]
- The model receives the shipment facts it may mention only as slot names, never values, and returns
  `{ subject_template, body_template }`.
- Slots: `{{GREETING_NAME}}`, `{{SHIPMENT_SUMMARY}}`, `{{QUOTE_OPTIONS}}` (required), `{{VALIDITY}}`,
  `{{SIGNATURE}}`. Code renders them (plain text, control characters stripped, length-capped, tariff
  text allowlisted).
- Guard: templates may contain **no digits** and none of a money-word/symbol list (currency codes,
  symbols, "euro/dollar/thousand/hundred/percent…" in the tenant's languages); `{{QUOTE_OPTIONS}}`
  must appear exactly once; unknown slots rejected. Number drift becomes structurally impossible.

## 9. Gate v2 (ordered) [R1#23]
`identity` (origin/destination unlocode) → `mode` (UNKNOWN → missing_required_field) → mode priced
(else out_of_scope_mode) → `service` (out_of_scope_service) → `cargo flags` (out_of_scope_cargo) →
`completeness` (missing_required_field + `missing_fields[]`) → `conflicts` (conflicting_cargo) →
`tariff match` (out_of_scope_lane | rate_expired | ambiguous_request) → `fx` (fx_stale) →
`confidence` (low_confidence).
New reasons (`out_of_scope_service`, `out_of_scope_cargo`, `conflicting_cargo`, `fx_stale`) land in
Zod, the DB constraint, dashboard labels and evals in **one** migration.

## 10. Guard v2 [R1#22]
Re-run the engine on the same tariffs + context; the canonical wire JSON of `candidates` must be
byte-identical. Canary scan on the wire form. Draft-template checks (§8).

## 11. Persistence [R1#24,25,26,27,30]
Expand-first migration, applied **before** any v2 producer ships:
- `quotes.quote_version int not null default 1` (existing rows = 1); v2 columns `mode`, `currency`
  (allowlist check), `total_minor bigint` (bounded check), `option_count int > 0`; legacy columns
  nullable only when `quote_version = 2` (check constraint).
- `quote_requests.outcome_detail jsonb` (missing_fields, ambiguity, trace summary).
- `quote_internals (request_id pk, tenant_id, pricing_result jsonb)` — service_role only.
- `persist_run_outcome` gains `p_outcome_detail jsonb default null`, `p_internals jsonb default null`
  and branches explicitly on `p_quote->>'quote_version'`; v1 path unchanged; SQL tests for both.
- **Lease-safe claim** [R1#30]: claim only `received`, or `processing` whose `claimed_at` is older
  than the lease (10 min); claim returns an attempt token stored on the row; persist requires the same
  token (mismatch = no-op). Fixes concurrent duplicate runs.

## 12. Consumers to migrate (explicit inventory) [R1#32,33]
CLI formatter · ingest run + store · Trigger run task · knowledge retriever query (v2 quote → query
from structured fields) · injection guard → core guard · evals (score, fixtures, runners) · web
(dashboard lib, QuoteDetail, list amounts, usage) · SQL tests · cassettes (re-recorded **in the same
commit** as any prompt/schema change; v1 cassettes kept until the switch commit).

## 13. Mock world (P1a slice)
Six fictional tenants (Linkport/Rotterdam EUR, Elbkai/Hamburg EUR, Prairiegate/Chicago USD,
Lumenstrait/Singapore USD, Kopjeveld/Johannesburg ZAR, Ventoleste/São Paulo BRL); 2–3 fictional
carriers each; FCL + LCL BUY tariffs drawn from documented 2026 bands with seeded PRNG; margin
policies; FX snapshot (ECB 2026-10-21); ~24 golden emails (FCL/LCL, EN/NL/DE/PT/ES/ZH; complete,
missing, conflicting, DG, door service, injection). Regeneration is byte-identical (tested). NOTICE
for attributions; every file marked SYNTHETIC.

## 14. Observability (P1a part) [R1#34]
`trace` persisted in `quote_internals`; `outcome_detail` summary on the request; structured log line
per run with reason, candidate counts, fx age, margin rule ids. Counters/alerts are P7.

## Delivery order (every step leaves main green)
1. core/money (Dec via big.js, Money, currencies, FX, wire codec) + conformance vectors.
2. core/places + equipment + import-boundary test.
3. core/request v2 + normalisation + derived totals/conflicts.
4. core/tariff model + validation + matcher (partial order, mixed equipment, ambiguity, pricing date).
5. core/modes FCL + LCL + generic charge evaluator.
6. core/margin + core/pricing engine (candidates, receipts, trace, ordering).
7. core/gate v2, core/draft renderer, core/guard v2.
8. DB expand migration (quote v2 columns, outcome_detail, quote_internals, lease claim, new reasons,
   atomic tariff RPC) + SQL tests — no producer change yet (v1 still written).
9. Legacy adapter + **line-by-line parity** of the old engine through core (all legacy fixtures).
10. Mock world generator + data + determinism test.
11. Switch: extraction v2, draft v2, runAgent v2, AgentOutput v2, CLI, ingest/worker (dual-read),
    dashboard v2 rendering, evals v2 + cassettes re-recorded — one atomic commit series behind tests.
12. Live run on Opus 5.5; Codex code review → fixes; agent reviews (pricing maths, security,
    architecture) → fixes; AUDIT_LOG.

## Assumptions to log (docs/ASSUMPTIONS.md, section H)
Half-up rounding per line; RT rounded up to 3 dp; W/M 1:1; 2% conflict tolerance; FX max age 7 days;
pricing date = max(as_of, ready_date); DG/reefer null = general cargo; quote validity default 14 days;
shipment-level charges from first equipment line; margin applies to BUY lines only.

## 15. Round-2 rules (override anything above that conflicts)
1. **Exact transport** [R2#1,2]: every price-affecting extracted value is a decimal **string** in the
   extraction schema (`"^-?\\d{1,9}(\\.\\d{1,6})?$"`); JSON numbers are rejected. Each measurement is
   `{ value, unit }` (weight: kg|lb|t; length: cm|m|in|ft; volume: cbm|cft); code normalises per field.
2. **Hard limits** [R2#3] (validated before any arithmetic, named rejection): request ≤ 50 container
   lines, ≤ 500 piece lines, piece qty ≤ 10,000; decimal strings ≤ 16 chars; tariff ≤ 5,000 lines,
   ≤ 50 charges/line; ≤ 20 carriers; ≤ 200 candidate options (excess → `out_of_scope_lane` detail
   `too_many_candidates`, never truncation without record); big.js DP fixed at 20, RM explicit per call.
3. **DG unknown** [R2#4]: `null` is quoted as general cargo **and** the rendered draft and QuoteView
   carry a code-rendered assumption line ("Quoted as non-hazardous, non-temperature-controlled general
   cargo"). `true` stays `out_of_scope_cargo`.
4. **Offers** [R2#5,6]: `RateLine.offer_id` (required). Mixed equipment composes only lines with the
   same `carrier` + `offer_id`. PER_SHIPMENT/PER_BL charges must be identical (id, rate, currency,
   min/max) across the composed lines or the option is rejected as `inconsistent_offer` (trace).
5. **Priority** [R2#7]: higher integer wins. Algorithm per (carrier, offer, equipment): candidates →
   non-dominated set (partial order §3) → keep max priority → exactly one ⇒ resolved, else ambiguous.
6. **Charge category** [R2#8]: `category: FREIGHT | SURCHARGE | LOCAL | DOCUMENT` on every ChargeDef;
   margin `applies_to` matches categories only.
7. **Margin order** [R2#9,10]: (a) MARKUP_ON_BUY/GROSS_MARGIN per eligible line (GROSS_MARGIN value in
   [0, 0.95]; MARKUP_ON_BUY in [0, 10]), rounded per line; (b) FLAT = one shipment-level `MARGIN_FLAT`
   line in its currency; (c) minimum margin checked **after** converting option buy and sell totals to
   the quote currency with the recorded FX; shortfall → one `MARGIN_ADJ` line in quote currency.
8. **FX** [R2#11,12,13]: cross conversions computed at full precision (DP 20) and rounded **once** to
   target minor units. Snapshot checked only if a non-identity conversion is needed: `0 ≤ age ≤ 7 days`
   relative to `as_of` (future-dated → `fx_invalid`), missing currency → `fx_missing_rate` (named).
9. **Validity** [R2#14]: `valid_until = min(every component line end, every parent tariff end,
   as_of + quote_validity_days)`.
10. **Guard scope** [R2#15,16]: re-derive the complete canonical `PricingResult` (candidates, presented,
    ordering, totals, trace) and require byte-identical wire JSON. Canary scan the full canonical
    `AgentOutput` + rendered draft + templates + outcome detail before persistence.
11. **Lease ownership** [R2#17,18,19]: the Trigger run id is the owner token (stable across retries of
    one run). Claim succeeds if `received`; or `processing` with the **same** owner (retry); or
    `processing` with `claimed_at` older than 70 min (beyond the 60 min max duration — stale steal).
    `persist_run_outcome` and `markError` require the owner token; mismatches are no-ops.
12. **Public projections** [R2#20,21]: `QuoteViewV2` and `OutcomeDetailPublic` are explicit Zod schemas
    built by **allowlisting** fields (presented options, sell lines with code/description/qty/rate-
    display/sell, totals, validity, transit, public assumptions; missing_fields, reason). Never buy,
    margin ids, source refs, unpresented candidates or trace. A test asserts no key from a denylist of
    sensitive names appears anywhere in either projection.
13. **quote_internals hardening** [R2#22,23]: revoke all from PUBLIC/anon/authenticated, RLS enabled
    with no policies, grant service_role only; included in the privilege lint + an SQL test. The RPC
    derives `tenant_id` from the claimed request row and rejects any mismatch.
14. **Draft contract** [R2#24]: code renders every commercial term (options, prices, validity,
    assumptions, terms reference) from tenant-owned templates. The model writes only
    `{ subject_template, greeting, intro, closing }` — each ≤ 600 chars, no digits, no money words/
    symbols, and none of a multilingual commitment-phrase denylist (free, complimentary, discount,
    waive, guarantee, included at no…). Residual risk (novel phrasing) is documented and mitigated by
    the human approval gate, which stays mandatory for every send in P1a.
15. **Tariff hash** [R2#25]: the hash is computed in code (SHA-256 over canonical JSON of the rows
    returned by the single atomic RPC, sorted by id) before pricing; receipts carry that computed hash.

## 16. Round-3 rules (highest precedence)
1. **Exact arithmetic** [R3#8, supersedes §1 big.js]: `Dec` is an exact decimal (bigint coefficient +
   scale). add/sub/mul are exact; the only divisions (FX cross rates, gross margin) are computed as one
   rational `numerator / denominator` with bigint quotient + remainder and a **single** half-up rounding
   into target minor units. big.js is a **devDependency used as an independent test oracle** in
   property tests, never at runtime.
2. **Margin formulas** [R3#6,7]: `MARKUP_ON_BUY: sell = round_half_up(buy × (1 + m))`;
   `GROSS_MARGIN: sell = round_half_up(buy / (1 − m))` (rational, single rounding). One `price_kind`
   per offer (validated); minimum margin is evaluated over BUY-derived lines only.
3. **FX receipts** [R3#9]: each conversion receipt is typed `BUY | SELL` with its own input/output.
4. **Offer key** [R3#10,11]: compose on `(tariff_id, carrier, offer_id)`. Shipment-level charges must be
   canonically equal as whole `ChargeDef`s (all fields) across composed lines.
5. **Clamps as money** [R3#12]: `min`/`max` are major-unit decimal strings in the charge currency,
   converted exactly to minor units at validation (must be representable; else tariff error).
6. **Field constraints** [R3#13]: dimensions, weights, volumes strictly > 0; counts positive integers;
   rates, clamps ≥ 0; margin values per §15.7. Defined once in the request/tariff schemas.
7. **Identity + hash** [R3#14]: tariff ids, rate-line ids and charge ids unique within a snapshot
   (validated); hash = SHA-256 over canonical JSON of the header + rows sorted by id.
8. **Recovery + requeue** [R3#1,2,15]: the scheduled poll also re-enqueues `processing` rows whose lease
   expired. `requeue_request` atomically deletes quote/draft/quote_internals and clears outcome_detail,
   extraction, owner and claimed_at (audit history kept). The owner-checked status transition is the
   first statement of `persist_run_outcome`; nothing is written when it does not match.
9. **Final escalation taxonomy** [R3#3,4,5] — single source in core, mirrored by one migration
   (Zod, DB constraint, dashboard labels, evals):
   `missing_required_field, out_of_scope_lane, out_of_scope_mode, out_of_scope_container (legacy),
   out_of_scope_service, out_of_scope_cargo, conflicting_cargo, request_too_large, rate_expired,
   ambiguous_request, tariff_config_error (all matched offers invalid / invalid tariff),
   pricing_capacity_exceeded, fx_invalid (stale or future snapshot), fx_missing_rate, model_refused,
   model_output_invalid, low_confidence, guard_violation`.

## 17. Implementation amendments (recorded during build)
1. **LCL cargo sources** (Codex engine review #5, rejected with reason): LCL is priceable when total weight
   AND total volume are both known, from pieces or stated totals in any combination. "3 pallets
   120×80×150 cm, total 1,200 kg" (dims + stated weight) is the commonest real phrasing; rejecting it
   would escalate normal emails. When both sources exist for a quantity, the 2% conflict rule applies.
2. **Unknown service** (gate): `UNKNOWN` → `missing_required_field [service]` (asked), not
   `out_of_scope_service`; most port-to-port emails never name a service type.
3. **No rates in customer text**: on BUY offers a line's rate is a cost, so customer-facing text and the
   sell-only projection show sell amounts only — never per-unit rates.
4. **Chargeable quantities**: PER_TON and PER_CBM charge on exact canonical quantities (t from kg 3 dp,
   m³ 6 dp); only the W/M revenue-ton quantity is rounded up to 3 dp.
5. **Amount bound**: any amount beyond 10^15 minor units excludes the offer (`amount_out_of_bound`); if
   no option survives for that reason the result is `pricing_capacity_exceeded`.
6. **Phrasebook drafting** (Codex task-7 review #1–#5, supersedes §8 and §15.14): the model's drafting
   output is a closed set of choices `{ language, formality, intro, closing }`; every customer-visible
   word is code-owned (six-language phrasebook), every inserted value is canonical (UN/LOCODE labels,
   charge-code dictionary, pricing result) or strictly patterned (a plain personal name). Email text,
   tariff descriptions and FX-source strings never reach the customer; carrier names only with
   `show_carrier`. One sanitising policy: NFKC + strip all Cc/Cf/Zl/Zp characters. A denylist guard on
   model prose is no longer needed — there is no model prose.
7. **Identity**: origin equal to destination → `ambiguous_request`.
8. **Draft trust boundary, precisely** (Codex phrasebook review): customer text is composed of
   (a) code-owned phrasebook text, (b) canonical values (port labels, charge-code names, engine
   numbers, dates), (c) TRUSTED admin-authored tenant configuration (signature, terms name, carrier
   label registry) and (d) an optional TRUSTED contact name from customer records (P3) — never email
   text, tariff free text, or tariff carrier strings. It shows per-line SELL amounts and totals by
   design; it never shows BUY costs or raw per-unit rate fields. Locales are allowlisted (Gregorian,
   Latin digits); malformed presentation data fails closed.
9. **Extraction wire** (live run, Anthropic strict-output grammar limits): the model returns a FLAT wire
   form with no unions and no optional fields (absent text/codes/dates as `""`, tri-state flags as
   yes/no/unknown, measurements as two flat fields). Code maps it to ShipmentRequest, which the core
   schema validates in full. An unstated container count is `qty 0`; any such line withholds the whole
   container list, so the gate asks — a partial quote is never produced (pricing review #1).
10. **Code ↔ place-text check**: the gate cross-checks the model's UN/LOCODE against a multilingual
    port-name index; a contradiction ("Antwerp" coded NLRTM) is `ambiguous_request`. Unknown names
    defer to the model.
11. **Confidence**: besides the overall floor (0.75), any price-relevant field the model rates below 0.5
    is `low_confidence` naming that field (ASSUMPTIONS E4).
12. **Cost confidentiality in customer text** (security review M1): options priced from BUY offers show
    the included charge names and the option total only — per-line amounts would reveal buy prices
    (pass-through lines at cost, uniform markups). SELL tariffs stay itemised; a tenant admin may opt
    into itemising cost-based quotes. QuoteViewV2 mirrors the email and carries the assumption lines.
13. **Guard v2, extended**: besides the byte-identical re-derivation, independent invariants (subtotals =
    Σ lines, quote total = subtotal + SELL FX receipt outputs, receipts trace to the snapshot's tariff
    hashes, no sell below buy, presented ⊆ candidates, validity ≥ as_of) and a check that the rendered
    email states every presented total.
14. **Plausibility bounds**: effective totals above 1,000,000 t or 10,000,000 m³ are `request_too_large`;
    `mm` is an accepted length unit; FLAT margin rules may not carry `min_margin`; duplicate
    `percent_of` references are a tariff error (pricing review #2, #4–#6).
15. **Observability**: one structured `quote_run` line per run (§14) and a `prompt_version` fingerprint of
    both prompts and output schemas on every AgentOutput; server-side model fallbacks are off unless the
    fallback models are eval-gated (invariant 8).
16. **Gate order** (held-out h09): a stated door service (DOOR_TO_PORT, PORT_TO_DOOR, DOOR_TO_DOOR) is
    decided before port identity — a door end is an address, so asking for its "port" is the wrong
    question; it escalates `out_of_scope_service`. Found by the held-out split on its first live run.
