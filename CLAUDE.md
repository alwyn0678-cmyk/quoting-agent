# CLAUDE.md — Working norms for QuoteAgent

## What this is
An open-source, production-grade, multi-tenant AI quoting platform for freight
forwarders worldwide. It reads inbound quote requests (email, portal, API),
extracts the shipment, prices it deterministically from the forwarder's OWN
rate data (Excel, SQL, TMS, …) for every mode (ocean FCL/LCL, air, express,
road FTL/LTL/groupage/drayage, rail, barge, multimodal door-to-door), and
drafts a reply a human approves. It must be plug-and-play: someone clones the
repo and gets a first quote in minutes. Works with any LLM provider.

The plan lives in `docs/ROADMAP.md`; per-phase task plans live in
`docs/superpowers/plans/`. The design record is the plan artifact
https://claude.ai/artifact/YQv3VhLe1mkGpsqujfHbtS.

## How you work here
- Work in phases (see ROADMAP). Every phase ends as an OPERATIONAL,
  production-ready pipeline that runs end to end with tests — never plumbing
  that only becomes useful later. If a task only adds unused scaffolding,
  it is in the wrong phase.
- Inside a phase: one task at a time, test first (red → green), smallest safe
  change, run the full suite, commit. Stop for review at the end of each
  phase and whenever a decision is genuinely the owner's.
- Supervised, not autonomous: describe the process honestly; never claim work
  ran unattended or was verified when it wasn't.
- Specs and tests carry the weight, not process docs. Ceremony is earned.

## Architecture invariants (non-negotiable)
1. The LLM handles language only. Deterministic code owns every number,
   decision, and outbound action. The model never computes or restates a
   price; drafts use slots that code fills.
2. Every quote line has a receipt: the rate row, snapshot/version, mapping
   version, FX rate and who confirmed it.
3. Untrusted input (email, attachments, tenant files, MCP tool output) is
   fenced to quarantined extraction steps. Outbound messages are built from
   templates + verified values; untrusted text never reaches an outbound
   channel or a later prompt as instructions.
4. Fail closed: any guard, policy or validation failure resolves to a named
   escalation reason, never a guess or a partial output.
5. Tenant identity comes from authentication and is enforced by the
   database (RLS) and tenant-scoped tool factories — never by prompt text or
   a client-supplied header.
6. Every side effect is idempotent and goes through policy; irreversible
   actions require a human until a lane has earned autonomy by measurement.
7. Provider-agnostic: all model access goes through the `LlmClient` port.
   No business logic may depend on a specific vendor.
8. Version everything that changes behaviour (prompts, models, rate
   snapshots, mappings, policies); any such change re-runs the eval gate.

## Tests
- Every acceptance criterion maps to exactly one pass/fail test. If a
  behaviour can't be a test, it's not a criterion — drop it or rewrite it.
- LLM steps are nondeterministic. Never assert exact-string equality on model
  output. Use structured output and assert on a normalized schema, a defined
  pass band, or predicates. Release gates use pass^k (all k runs pass), and
  safety fixtures must always pass.
- The offline suite is hermetic (no keys, no network) and gates every commit.

## Domain humility (enforced every phase)
- Nobody here is a freight-pricing authority. Any rate, surcharge, formula,
  incoterm rule, or "what a typical email looks like" claim is an ASSUMPTION
  until checked against a primary source or a real tariff. Log every one in
  docs/ASSUMPTIONS.md: claim · source (or "invented") · how to verify.
- Mock data is clearly fictional and generated, never copied from real
  tariffs. Respect source licences (attribution in NOTICE).

## What to protect under time pressure
- PROTECT: a working end-to-end pipeline for each shipped phase; the
  invariants above; the test suite and eval gate; ASSUMPTIONS.md; AUDIT_LOG.md.
- CUTTABLE: peripheral docs and polish. Never thin a working pipeline to
  preserve a doc.

## Owner context
- Owner: Alwyn. Supabase + Vercel + Trigger.dev accounts exist. Docker runs
  via Colima on this machine.
- Never commit secrets. `.env` stays gitignored.
