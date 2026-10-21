# Mock world spec (research 2026-10-21)

No design partner yet, so QuoteAgent ships a **realistic, clearly fictional** world built from public
*structures* — never copied tariff tables. Every generated number is a seeded draw from a documented
band; every band is an ASSUMPTION (log in ASSUMPTIONS.md with its anchor). Sources were read
2026-10-21; "secondary" = search summaries, verify before quoting.

## Licensing constraints (verified)
- **UN/LOCODE:** licence unclear (UNECE terms: personal/non-commercial; upstream repo GPL-3.0). Commit a
  hand-picked subset (~150–300 codes) with attribution; fetch the full list at build time if needed.
  CSV: https://raw.githubusercontent.com/datasets/un-locode/main/data/code-list.csv. Function string by
  position: 1 sea · 2 rail · 3 road · 4 airport · 5 postal · 6 multimodal · 7 fixed · 8 inland water.
  Coordinates like `4230N 00131E`.
- **Airports:** OurAirports, Unlicense — https://davidmegginson.github.io/ourairports-data/airports.csv
  (filter `scheduled_service=yes` + IATA code).
- **Airlines:** OpenFlights is ODbL — don't commit; use fictional carriers.
- **ISO 6346:** standard is paid; hand-enter ~12 codes (22G1, 42G1, 45G1, 22R1, 45R1, 22U1, 42U1, 22P1,
  42P1, 22T1, L5G1).
- **ISO 3166 / 4217:** `datasets/*` licences unclear → hand-curate or use Unicode CLDR (Unicode License v3).
- **FX:** ECB reference rates (reuse allowed with citation, "information only"). Snapshot 2026-10-21,
  per EUR: USD 1.1234 · GBP 0.83825 · CNY 7.4999 · SGD 1.4348 · ZAR 18.3930 · BRL 5.6432 · HKD 8.8155 ·
  INR 106.1265.
- **Postcodes:** GeoNames CC BY 4.0 (attribution required); zone on 2-digit prefix (DE/NL) or ZIP3 (US).
- **Distances:** offline haversine × circuity (road ×1.20–1.30 EU / ×1.15–1.25 US; rail ×1.25–1.35 —
  assumptions); sea distances precomputed once with searoute-py (Apache-2.0, credits Eurostat SeaRoute).
- **Emissions:** UK DESNZ/DEFRA 2026 conversion factors (OGL v3.0). GLEC defaults are member-gated —
  reference the method by name only.
- **T&Cs:** FENEX/ADSp/BIFA/NCBFAA texts are copyrighted — name the *style* only, never reproduce.

## 2026 market context (secondary unless noted)
Hormuz crisis since March 2026 → emergency bunker/freight surcharges (e.g. Maersk EBS $200/20' $400/40');
US diesel > $6/gal (DAT, Sep 2026); EU diesel ≈ €1.96/l (IRU, Q1); air fuel surcharges ~3–4× normal;
Rhine low water (Kaub 14 cm on 2026-09-22). The mock world should be **surcharge-heavy and volatile**.

## Structural models (to imitate, never copy)
- **Forwarder general tariff** (Forto NL Q3-2026 PDF, verified): charge code · description · amount ·
  basis rows (THC per container, ISPS, docs per B/L, VGM, AMS per B/L); demurrage/detention tiers by day
  with 20'/40' columns; LCL per W/M with minimum; intermodal add-ons (reefer, DG, 45'); low-water gauge
  bands (Kaub 150–131 cm: €40/20' €50/40' … ≤80 cm free agreement); customs per declaration + per extra
  HS line; air export per kg with minimums, fuel %, X-ray, docs per AWB.
- **Carrier THC sheet** (Hapag-Lloyd Europe Jun-2026, verified): country/port rows, currency column,
  equipment sub-headers, valid-until/effective row pairs — the archetype "messy merged-header" sheet.
- **US LTL**: base per CWT by class × weight break × distance, then discount %, absolute minimum,
  fuel %, accessorials. NMFC 13-band density classes (verified, effective 2025-07-19).
- **EU groupage**: 2-digit postcode zones × weight bands + diesel floater % (public German shipper list).
- **Express**: zone × 0.5 kg grid, volumetric ÷5000.

## Fictional tenants (names web-checked only; verify registries before publishing)
| # | Name | City | Ccy | Langs | Modes | Rate-source formats |
|---|---|---|---|---|---|---|
| T1 | Linkport Forwarders BV (existing) | Rotterdam | EUR | NL EN DE | FCL, LCL, air (AMS), barge, rail intermodal, Benelux groupage | wide FCL xlsx (carrier, POL, POD, via, validity, 20DC/40DC/40HC/40RF, BAF, ETS, EBS, remarks, merged notes); LCL W/M sheet; barge per-box + LWS gauge table; carrier-PDF-style local charges |
| T2 | Elbkai Spedition GmbH | Hamburg | EUR | DE EN PL | FCL, LCL, China–Europe rail, groupage, FTL, air HAM/FRA | groupage zone × weight table + diesel floater; rail per-unit list; scanned-looking rail sheet |
| T3 | Prairiegate Freight LLC | Chicago | USD | EN ES | LTL, FTL, drayage, air import ORD, ocean import | LTL class × CWT tariff + discount + minimum; DOE-keyed fuel table; drayage accessorial schedule; FTL per-mile lanes; TMS CSV export |
| T4 | Lumenstrait Cargo Pte Ltd | Singapore | USD (+SGD local) | EN ZH | air (SIN), express, intra-Asia + Asia–EU FCL/LCL | air weight-break matrix (Min, -45, +45, +100, +300, +500, +1000, FSC/kg, SSC/kg); express zone grid; LCL co-loader sheet |
| T5 | Kopjeveld Freight (Pty) Ltd | Johannesburg | ZAR (ocean USD) | EN AF | FCL via ZADUR, road/rail to City Deep, air JNB, cross-border FTL | FCL sheet; inland list per 20'/40' + weight surcharge; cross-border per-load list |
| T6 | Ventoleste Logística Internacional Ltda | São Paulo | BRL (freight USD) | PT EN ES | FCL/LCL BRSSZ→EU/US, air GRU, Mercosur road | FAK all-in sheet; messy co-loader LCL sheet |

Use `.example` domains, fictional carriers ("Northwind Lines", "Aurora Air Cargo"), fake phones (US
555-01xx; UK 01632 960xxx), IBAN-shaped `TEST` strings that fail checksum, and a "SYNTHETIC — not real
rates" header on every file.

## Generator bands (2026)
- **Ocean per 40' DC:** FE→N Europe $2,800–4,600 · FE→Med $3,300–4,900 · FE→USWC $5,000–8,500 ·
  FE→USEC $6,500–11,500 · N Europe→USEC $2,400–3,300 · ECSA→N Europe $2,300–3,000 · Durban→N Europe
  $2,000–3,500 (invented). 20' = 0.6–0.85 × 40'; 40HC = 1.00–1.05 × 40DC; reefer 1.6–2.2 × dry.
  Emergency bunker $200/20' $400/40'; ETS $20–80/TEU; THC €240–330; ISPS €20–35; docs €50–70/B/L;
  D&D 3–8 free days then €85–250/day. (Anchors: Drewry WCI 2026-10-15, Xeneta 2026-10-07, CMA CGM/MSC FAK.)
- **LCL:** $60–150/W/M Asia→EU (low confidence); O/D charges €25–35/W/M + €30–50/B/L.
- **Air:** $2.20–4.50/kg by lane (anchors: Xeneta global $3.10, CN→W Europe $4.15); fuel $1.00–1.60/kg;
  security $0.10–0.20/kg; breaks fall 5–12% per step (assumption).
- **Road:** EU FTL €1.40–2.30/km; diesel floater 8–22%; US van FTL $2.60–3.60/mi all-in (DAT); LTL
  discount 65–80%, fuel 25–40%.
- **Drayage:** $550–1,100 per 40' + chassis $35–50/day, split $25–75, pre-pull $150–300, storage
  $50–100/day, per diem $100–160/day (low confidence).
- **Rail China–Europe:** $6,900–10,000 per 40', 11–20 days; peak $500–1,000; border $200–400.
- **Barge Rotterdam→Duisburg:** €250–450 per 40' base (invented) + LWS bands.

## Request-email corpus (~120, each `.eml` + ground-truth JSON: fields, missing fields, expected action `quote | clarify | route_human | refuse`)
Complete 30 · missing field 20 (incoterm 5, dims/weight 5, address/postcode 4, ready date 3,
commodity 3) · ambiguous 14 · multi-option 8 · multi-lane 6 · thread follow-up 12 · attachment-based
10 · out of scope 8 · prompt injection 6 (body, attachment cell, signature, hidden HTML, quoted
thread, "apply 0% margin") · PII-heavy 6.
By mode: FCL 28 · LCL 14 · air 20 · express 6 · FTL 10 · LTL/groupage 14 · drayage 6 · rail 8 ·
barge 4 · multimodal 10. By language: EN 58 · DE 16 · NL 14 · PT 14 · ES 10 · ZH/mixed 8.
Seed ambiguities: missing/contradictory Incoterm, "40ft" vs HC, "door to door Shanghai to Munich",
pallets without dims or stackability, tons vs short tons, lbs vs kg, Portland OR/ME, "ASAP", "CIF" for
air, attachment overriding the body.

## Tender workbooks (all with merged headers, a hidden column, mixed units, a comments sheet, one typo'd duplicate lane)
1. Ocean FCL tender → Linkport, 120 lanes: Lane_ID, Origin_country, POL, POD, Final_dest, Incoterm,
   Service, Equipment, Annual_FEU, Commodity, HS_chapter, DG, Reefer_temp | bid: OF, BAF_incl, ETS_incl,
   THC_O, THC_D, Transit_days, Free_DEM, Free_DET, Validity, Remarks.
2. EU road tender → Elbkai, 80 lanes: Lane_ID, From_CC, From_PC2, To_CC, To_PC2, Type, Pallets_yr,
   Avg_kg, Shipments_wk, Tail_lift, ADR | bid: EUR_per_shipment, EUR_per_km, Diesel_base_EUR_l, Lead_time_days.
3. Air tender → Lumenstrait, 50 lanes: Lane_ID, Orig_IATA, Dest_IATA, Annual_chargeable_kg,
   Avg_shipment_kg, Service_level | bid: Min, -45, +45, +100, +300, +500, +1000, FSC_incl, SSC_incl, Transit_days.

## NOTICE file lines
GeoNames (CC BY 4.0, modified to prefixes/centroids) · UN/LOCODE subset © UNECE (status unclear; not
endorsed) · OurAirports (Unlicense) · ECB FX snapshot 2026-10-21 unmodified, information only · UK
DESNZ GHG factors 2026 (OGL v3.0) · searoute-py (Apache-2.0; Eurostat SeaRoute) · "All companies,
people, carriers, rates and emails are fictional; ranges informed by public indexes (Drewry WCI,
Xeneta, DAT, Ti/Upply/IRU); no tariff tables copied; trading-condition names only."

## Design-partner leads (informational — nobody contacted)
Associations: FENEX, DSLV, BIFA, NCBFAA, SAAFF, SLA, ACTC/SINDICOMIS, FIATA directory. Networks: WCA,
JCtrans, GLA, Pangea. Example independents with public pages: Emons Air & Sea (Hamburg), Shapiro
(Baltimore), Mohawk Global (US), Carmichael International (LA), Resources Freight (Singapore), 2020
Logistics (Johannesburg). Allink (São Paulo) is a forwarder-only LCL consolidator — a good model for a
co-loader rate source.
