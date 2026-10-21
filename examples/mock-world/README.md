# Mock world

Six fictional freight forwarders used for demos, evals and tests while QuoteAgent has no design
partner. Regenerate with `npm run mockworld:gen` (deterministic — a test fails if these files drift).

| Tenant | City | Quotes in | Modes | Lanes (ocean) |
|---|---|---|---|---|
| `linkport` — Linkport Forwarders BV | Rotterdam | EUR | FCL, LCL | CNSHA/CNNGB/SGSIN → NLRTM; NLRTM → USNYC/USSAV |
| `elbkai` — Elbkai Spedition GmbH | Hamburg | EUR | FCL, LCL | CNSHA/CNTAO → DEHAM; DEHAM → USNYC |
| `prairiegate` — Prairiegate Freight LLC | Chicago | USD | FCL, LCL | CNSHA/CNSZX → USLAX; NLRTM → USNYC |
| `lumenstrait` — Lumenstrait Cargo Pte Ltd | Singapore | USD | FCL, LCL | SGSIN → NLRTM; CNSHA → SGSIN |
| `kopjeveld` — Kopjeveld Freight (Pty) Ltd | Johannesburg | ZAR | FCL, LCL | ZADUR → NLRTM; CNSHA → ZADUR |
| `ventoleste` — Ventoleste Logística Internacional Ltda | São Paulo | BRL | FCL, LCL | BRSSZ → NLRTM/USNYC |

Tariffs are BUY rates in USD with local charges in the tenant's currency; each tenant has default
margin rules (FCL markup 10% on freight + surcharges; LCL gross margin 15% with a minimum). One carrier
per tenant has a rate that expires on 2026-11-15, so "rate expired" paths are exercised. See `NOTICE.md`.
