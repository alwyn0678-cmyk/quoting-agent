# Pricing-engine design research (2026-10-21)

Read-only study of dinero.js v2, Medusa pricing module, karrio (rate sheets, markups), Saleor + `prices`,
Odoo delivery rules + pricelists, Apache OFBiz shipment cost estimates. Full report in the session log;
decisions it drove are in the P1a spec (docs/specs/2026-10-21-p1a-multimodal-core.md).

## Adopted
- **Scaled integers everywhere** (dinero's amount + scale): exact multiply (scales add), rounding only
  explicit, never a default mode (dinero `transformScale` defaults to truncation; BigInt `/` truncates).
- **Unambiguous rounding names.** "Half-up" is away-from-zero in Python but towards +∞ in dinero.js —
  currency.js produced 10.075 → 10.08 but −10.075 → −10.07 on credit notes. Ours: HALF_AWAY_FROM_ZERO,
  HALF_EVEN, CEILING, FLOOR.
- **Commercial rounding = half away from zero**, once per line; totals are exact sums (karrio rounds lines
  and the total separately, so displayed lines can fail to add up). Grounds (VAT, by analogy — an
  ASSUMPTION for freight): Hoge Raad 15 May 2009 (Ahold) "halve centen naar boven"; Reg. (EC) 1103/97
  Art. 5 rounds exact halves up.
- **Explicit pricing date input**, never `now()` inside the matcher (Medusa cannot replay old quotes).
- **Explicit `ambiguous` result** instead of cheapest-wins (Medusa, karrio), newest-id (Odoo) or
  query-order overwrite (OFBiz weighted sum).
- **Structured "no rate" with near misses** instead of Odoo's reason-less "Not available".
- **Percent margins computed on cost, never on a running total** (karrio compounds markups in
  `-created_at` order).
- **Exact unit constants** (1 lb = 0.45359237 kg; karrio uses /2.205).
- **Exponent is data** (Stripe: ISK/UGX/HUF quirks), money stored as bigint minor units + currency.
- **Receipts** reproducible from the shown numbers (Medusa returns price id + list id — lightweight
  provenance; ours adds tariff hash, line, charge, margin rule, FX receipt).

## Considered, not adopted (and why)
- Converting FX per line (1103/97-style): we convert once per currency subtotal (fewer roundings), with a
  typed receipt per conversion — chosen during Codex review.
- Lexicographic specificity tuple: we use a **partial order** (dominance) per Codex review, so
  incomparable matches surface as ambiguous rather than being ordered by an arbitrary dimension rank.
- Customer-contract specificity: deferred to P3 (needs a trusted customer identity).

## Pitfalls list (keep as regression-test ideas)
Floats in pricing · rounding lines and totals independently · implicit truncation · mode-name confusion ·
arbitrary tie-breaks · `now()` in matching · inclusive–inclusive tiers overlapping at boundaries ·
time-zone drift on validity dates (Odoo #88056) · compounding markups · approximate unit constants ·
rounded/inverse FX rates · hard-coded exponent 2 · silent "no price".
