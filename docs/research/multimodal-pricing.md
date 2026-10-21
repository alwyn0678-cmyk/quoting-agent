# Multimodal pricing research (2026-10-21)

Labels: **[V]** verified at source · **[S]** secondary · **[K]** background knowledge, unverified ·
**[I]** design opinion. Every figure is an ASSUMPTION until logged in ASSUMPTIONS.md and checked
against a real tariff.

## Per-mode pricing model
| Mode / sub-mode | Chargeable unit | Conversion | Typical lines (basis) | Key request inputs |
|---|---|---|---|---|
| Ocean FCL | containers by ISO type [K] | — | freight, BAF, THC O/D, PSS, ETS, ISPS (per box); docs (per B/L) | ports, equipment, qty, commodity |
| Ocean LCL | revenue tons | max(t, m³), 1 t = 1 m³ [K]; min often 1 RT | freight per RT, CFS, docs | ports, pieces, dims, weight |
| Road FTL | truck per lane / per km | capacity ~24 t, 13.6 LDM [K] | linehaul, stops, waiting/hr; fuel floater %, tolls per km | addresses + postcodes, date, equipment, weight, ADR, temp |
| Road groupage (EU) | chargeable kg | max(actual, m³×333, LDM×k); LDM = L×W/2.4; k = 1850 Continent / 2000 UK-Nordics / 1750 DSV FR non-stack [S] | zone × weight tariff, minimum; diesel floater (DSV: +0.5 pt per 4% index change groupage, +1.0 direct [V]) | postcodes, pieces, dims, weight, stackable, ADR, tail-lift |
| Pallet networks | pallet class | quarter ≤250 kg, half ≤500, full 1000–1250 by network [S] | per pallet × zone | pallet count by class, postcodes |
| US LTL | CWT at NMFC class | density lb/ft³ → 13-band class (2025-07-19) [V] | tariff × CWT less discount (70–90% [S]), minimum; fuel % on EIA diesel; accessorials | ZIPs, dims (in), weight (lb), class, liftgate, residential |
| Drayage | per container move | — | linehaul; chassis/day; split; pre-pull; detention after free time [S] | terminal, door, size, weight, live/drop, last free day |
| Rail intermodal (EU) | per loading unit, weight band [K] | — | main leg, lifts, first/last mile | terminals, unit type, weight, DG |
| Rail China–Europe | per FEU/TEU, COC or SOC [V] | — | through rate (avg ~$10,100/FEU COC, Jul 2026 [V Index1520]); lease ~$1,400 [V]; GPS e-seals ~$500 [V] | terminals, box ownership, commodity screen, corridor |
| NA intermodal | per 53' load [K] | — | rail + dray; fuel per mile (UP bands from EIA [V]) | ZIPs, equipment, weight |
| Barge (Rhine) | per box, full/empty | LWS per container, laden only [V Contargo] | freight, lifts, last mile; LWS by gauge | seaport + inland terminal, size, full/empty, departure date |
| US river barge | $/t as % of 1976 benchmark [S] | rate = pct × benchmark | — | segment, tons, commodity |
| Air general | chargeable kg | max(actual, Σ L×W×H cm ÷ 6000), up to 0.5 kg [S] | rate by weight break; minimum; fuel + security per kg | airports, pieces, dims, weight, DGR |
| Express | chargeable kg by zone | ÷5000 [V DHL]; US parcel in³/139 [S] | zone × weight; fuel %, remote, oversize | addresses, dims, weight, service |
| Air ULD | per ULD | max(min, pivot + over-pivot kg × rate) [S/I] | per ULD | ULD type, gross weight |
| Sea-air | chargeable kg | air leg ÷6000 [I] | through rate per kg | origin port, hub, destination airport |

Worked surcharges: Contargo LWS Kaub bands 150–131 cm €40/€50 (20'/40'), 130–111 €55/€75, 110–101
€75/€90, 100–91 €90/€145, 90–81 €120/€165, ≤80 by agreement; gauge by terminal location (Kaub,
Cologne, Duisburg-Ruhrort, Emmerich); ELWIS reading at 05:00 CET on the departure day [V]. German Maut
on trucks > 3.5 t since 2024-07-01, CO₂ component €200/t [S]. Cabotage: 3 operations in 7 days then 4
days cooling-off [S].

## Canonical model [I]
```
Quote → options: RouteOption[]
RouteOption: legs: Leg[] (leg[i].destination == leg[i+1].origin) · pricing THROUGH | COMPOSED
  · throughRate? · totals per currency (never silently FX-collapsed)
  · transitDays {min,max,basis} · co2e {kgWTW, method, perLeg[]} · validity · assumptions[]
Leg: mode OCEAN|AIR|COURIER|ROAD|RAIL|BARGE · subMode FCL|LCL|AIR_GENERAL|AIR_ULD|EXPRESS|FTL|LTL_EU
  |LTL_US|PALLET|DRAYAGE|CT_INTERMODAL|RAIL_EURASIA|NA_INTERMODAL|BARGE_CONTAINER|CHARTER
  · role PRE_CARRIAGE|MAIN|ON_CARRIAGE|HANDOVER · origin/destination: Place · cargo
  · chargeable {module, inputs, qty, unit, version} · charges: ChargeLine[] · distanceKm {value, source}
Place: ADDRESS|POSTCODE|UNLOCODE|IATA|TERMINAL|RAIL_RAMP · country, postcode, codes, geo
ChargeLine: code · basis PER_SHIPMENT|PER_UNIT|PER_KG|PER_CWT|PER_LDM|PER_KM|PER_STOP|PER_HOUR|PER_DAY
  |PCT_OF(lines)|INDEXED(index,table)|PASS_THROUGH · rate · currency · min/max · qty · amount
  · source (rate row | assumption) · conditional?
```
- A through-rate is one MAIN leg with `scopeIncludes[]`; the composer refuses to add a separately priced
  leg for anything in scope (blocks double-charging, the likeliest silent error).
- Composed options sum legs + an explicit HANDOVER leg at each joint.
- Percentage surcharges name exactly the lines they apply to.

## Mode-aware completeness gate [I]
| Sub-mode | Required to quote | Ask if missing |
|---|---|---|
| FTL | addresses/postcodes + country, pickup date, equipment, gross weight | ADR, temperature, stops, loading times |
| LTL EU / pallet | postcodes + country, pieces, L×W×H each, weight, stackable | ADR class/UN, tail-lift, pallet type |
| LTL US | ZIPs, pieces, dims (in), weight (lb) | NMFC item/class, liftgate, residential, appointment |
| Drayage | terminal/ramp, door, container size/type, gross weight | live/drop, last free day, hazmat, overweight |
| Rail CT / Eurasia | terminals or regions, unit type, gross weight | COC/SOC, commodity screen, DG, door legs |
| Barge | seaport + inland terminal, size, full/empty | weight, departure week |
| Air general / ULD | airports or addresses, pieces, dims (cm), weight | DGR, commodity, ready date |
| Express | addresses, dims, weight | service level |
Rule: whenever a volumetric/density calculator applies, dims + weight are required to pass the gate.

## Mode modules (pure functions, each with worked-example tests)
FCL_UNITS · LCL_WM · AIR_VOL_6000 · EXPRESS_VOL_5000 · US_PARCEL_139 · ULD_PIVOT · ROAD_LDM ·
PALLET_PLACES · US_LTL_CLASS (13-band: <1→400, 1–2→300, 2–4→250, 4–6→175, 6–8→125, 8–10→100,
10–12→92.5, 12–15→85, 15–22.5→70, 22.5–30→65, 30–35→60, 35–50→55, ≥50→50; NMFC item may override;
CWT with deficit-weight re-rate) · FTL_LANE / FTL_PER_KM · RAIL_UNIT · BARGE_BOX · US_BARGE_TARIFF_PCT ·
FUEL_STEP_TABLE (EU weekly Oil Bulletin; DSV since 2026-03-16 [V]) · FUEL_PER_MILE (EIA) ·
LOW_WATER_GAUGE · TOLL_PASSTHROUGH · CO2E_LEG (ISO 14083 method; placeholder factors).

## Regional notes
EU: postcode-zone groupage, weekly diesel floaters, CO₂-differentiated tolls, cabotage, ADR 2025, e-CMR
spreading, eFTI — authorities must accept certified platform data from 2027-07-09 [V]. US: class × CWT
LTL with long accessorial lists, EIA-keyed fuel, drayage accessorials rival linehaul. Asia–Europe: rail
≈ 2× WCI per FEU (Jul 2026 [V]); Q1 2026 China–Europe rail 546k TEU +22% [V]; Middle Corridor growing;
sea-air shifted Dubai → LAX on Gulf disruption [V Flexport]. Brazil: legal minimum road rate (ANTT piso
mínimo) is a floor the engine must enforce [S].

## Open verification items
GLEC factor tables; IATA TACT wording (÷6000, 0.5 kg, M/N/Q); 2026 Maut tables; UNECE e-CMR party count;
ADN/IATA DGR editions; NMFC 2026 dockets; EU sanctions on Russia/Belarus rail transit; EU combined
transport tariff structure; LCL 1:1 W/M convention; US domestic intermodal lane rates.

Key sources: NMFTA density (nmfta.org), Contargo LWS (contargo.net/en/goodtoknow/lws), EC eFTI page,
DSV diesel floating, Index1520 Jul-2026, Flexport sea-air, ISO 14083, DHL volumetric weight, EIA FAQ,
UP fuel table.
