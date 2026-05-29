# CLAUDE.md — Working norms for QuoteAgent

## What this is
Portfolio + learning project. An AI agent for a fictional Dutch freight
forwarder (Linkport Forwarders BV): reads an inbound FCL Rotterdam→NY quote
email, extracts the request, looks up a rate, drafts a reply. Success = I can
explain every component to a senior AI hiring manager without hand-waving.
Not revenue, not users, not feature count.

## How you work here
- You are a supervised execution engine, not an oracle. One task at a time,
  smallest safe change, run its test, stop. I review between every task.
- This is Ralph *principles applied manually* (one task, fresh focus,
  spec-as-state) — NOT an autonomous loop. Describe it that way; never claim
  it ran unattended.
- Specs and tests carry the weight, not process docs. Ceremony is earned.
  Do not create a doc until there is something real to put in it.

## Tests
- Every acceptance criterion maps to exactly one pass/fail test. If a
  behavior can't be a test, it's not a criterion — drop it or rewrite it.
- LLM steps are nondeterministic. Never assert exact-string equality on model
  output. Test at temperature 0 with structured/JSON output, and assert on a
  normalized schema or a defined pass band. How we handle nondeterminism is a
  deliberate, documented choice.

## Domain humility (enforced every phase)
- I am NOT a freight-pricing expert. Any rate, surcharge, incoterm rule, or
  "what a typical email looks like" claim you generate is an ASSUMPTION, not a
  fact. Log every one in ASSUMPTIONS.md: claim · source (or "invented") · how
  to verify. Never state a domain claim as established fact anywhere.

## What to protect under time pressure
Priority order is fixed:
- PROTECT: a working end-to-end demo of the core; the three learning-goal docs
  (agent design, evals, observability); AUDIT_LOG.md; ASSUMPTIONS.md.
- CUTTABLE: peripheral docs (RELEASE_PLAN, full RISK_REGISTER, CHANGELOG depth)
  AND peripheral integrations (MS Graph depth, dashboard polish).
- Never cut or thin the working demo to preserve a peripheral doc.

## Phase boundaries
- Phase 0 (now): CLI slice only — email in → extraction → rate lookup →
  drafted reply. Nothing else.
- Phase 1+ (later): MS Graph, Outlook, Excel Online, dashboard, auth,
  Trigger.dev, monitoring. Do not pull any of this into Phase 0.
