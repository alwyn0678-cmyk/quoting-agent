# Roadmap — QuoteAgent → production freight-quoting platform

Design record: https://claude.ai/artifact/YQv3VhLe1mkGpsqujfHbtS · research notes: `docs/research/`.
Rule: **every phase ships an operational, tested, end-to-end pipeline** — no scaffolding that only
pays off later. Each phase ends with an owner review. Task-level plans live in
`docs/superpowers/plans/`.

## Target in one paragraph
Any freight forwarder clones or installs QuoteAgent, points it at their own rate data (Excel, CSV,
SQL, TMS), connects a mailbox or portal, and gets priced, itemised, source-cited quote drafts for
every mode — ocean FCL/LCL, air, express, road FTL/LTL/groupage/drayage, rail, barge and
door-to-door combinations — which a human approves until each lane has earned autonomy by
measured accuracy. Works with any LLM provider; runs with no keys in demo mode.

## Phases

| Phase | Ships (operational) | Exit test |
|---|---|---|
| **P0 Foundation** ✅ in progress | Expired rates escalate; DB privilege hole closed + lint; any-LLM layer (Anthropic native, AI SDK for the rest); keyless demo via recorded responses; RAG on the production path; CI runs unit + replay e2e + SQL proofs; human actions attributed; extraction persisted; signup closed | Fresh clone: `npm install && npm start -- evals/fixtures/01-complete-40hc-x2.json` prints a priced draft with no keys; live golden set 8/8 on the default model; CI green |
| **P1a Core model + ocean** | Money, Place, Route/Leg/ChargeLine, ShipmentRequest v2, mode-aware completeness gate, FCL + LCL modules, margin rules, FX snapshot, line receipts, mock world (6 fictional forwarders, seeded generator) | Old FCL fixtures pass through the new engine; LCL golden fixtures exact |
| **P1b Air, express, road** | Air volumetric + weight breaks + ULD, express zones, FTL lane/per-km, EU groupage (LDM), US LTL (density class), drayage accessorials, indexed fuel floaters, tolls | Golden fixtures per sub-mode; each formula tested against worked examples |
| **P1c Rail, barge, door-to-door** | Rail intermodal + Eurasian, Rhine barge with gauge-banded low water, through vs composed routes, multiple options per request, transit + CO₂ per leg | Shanghai → Duisburg returns ocean, rail and sea-air options; no double-charging of through-rate scope |
| **P2 Rate ingestion** | Connector interface; Excel/CSV with versioned mapping templates; AI-proposed mapping in a bounded loop + human confirm UI; snapshot diffs; Sheets/SharePoint; SQL edge agent | Messy-sheet golden set maps to canonical rows above the agreed precision bar |
| **P3 Multi-tenant runtime + install** | Tenant registry/settings, roles + SSO, tenant-scoped worker tokens (RLS everywhere), Vault secrets, RLS lint; `quoteagent` CLI (`init`, `quote`, `dev`, `doctor`), Docker Compose profiles, pnpm/turbo workspace | Two tenants side by side with isolation proofs; install-to-first-quote < 5 min in a clean container (CI-enforced) |
| **P4 Channels + conversations** | Normalised inbound messages, per-tenant forwarding address, multi-tenant Graph + Gmail, attachments, threads, templated clarification loop, replies in the customer's language | Incomplete request → one in-thread question → completes on the reply |
| **P5 Documents + lifecycle** | Numbering, snapshot-on-issue, branded PDF, signed accept link, revisions/expiry/rejection, quote → booking outbox | Rate change after issue never alters an issued quote |
| **P6 Tenders** | Shipper workbook ingest, per-lane isolated extraction, pricing, gap/expiry flags, write-back into their template, exceptions-first grid | 120-lane fixture round-trips with layout preserved |
| **P7 Governance + operations** | Policy-as-code per tenant, OTel GenAI → Langfuse, cost caps + kill switch, pass^k release gate, calibrated confidence → graduated autonomy, reviewer-edit flywheel | Every side effect has a policy decision and an attributed audit row; safety fixtures pass^5 |
| **P8 Launch** | New name, README + GitHub page redesign, docs site, public REST API + MCP server, onboarding wizard with shadow mode | A new forwarder goes from signup to first shadow quote unaided |
| **P9 Enterprise** | CargoWise / Magaya adapters (partner-gated), Azure marketplace, self-host bundle | Driven by the first enterprise customer |

## Decisions recorded
- 2026-10-21: re-scoped from portfolio demo to production product (owner).
- 2026-10-21: keep this repo; improve it locally and on GitHub (owner).
- 2026-10-21: all modes, not just ocean (owner).
- 2026-10-21: default to the strongest available model; any provider via config (owner).
- 2026-10-21: no design partner yet — build a realistic, clearly fictional mock world from public
  structures (see `docs/research/mock-world-spec.md`).
- 2026-10-21: rename + README/GitHub redesign happen at P8 (owner).
