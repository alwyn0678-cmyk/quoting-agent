# SLICE_PLAN.md — Phase 0 implementation plan

> One task per iteration. Each task = smallest safe change, names the **single test** that proves
> it done, then **STOP** for review (Gate 2 of the per-phase lifecycle). Tests refer to IDs in
> `ACCEPTANCE_TESTS.md`. Do not start until this plan is approved.

## Recommended tooling (flagged — confirm or override at Task 1)

- Node 20+, TypeScript, **Vitest** (test runner — recommendation; Jest/`node:test` are fine
  substitutes), **Zod** (schemas), **@anthropic-ai/sdk** (LLM). **Pinned model: `claude-opus-4-8`
  (Opus 4.8)** — temperature omitted (deprecated for this model; confirmed 2026-05-29).
- Layout per canonical plan: slice CLI in `apps/cli/`, agent loop in `packages/agents/`, fixtures
  + runner in `evals/`.
- These are the only "new" choices beyond the canonical plan; see `ASSUMPTIONS.md` E3 for the cost
  constants.

## Build order (dependency-ordered; deterministic core before LLM steps)

| # | Task (smallest safe change) | Proving test | Stop-after deliverable |
|---|---|---|---|
| 1 | **Scaffold + harness.** `package.json`, `tsconfig`, Vitest config; a trivial passing test. | `npm test` runs; one sample test green. | A test harness that runs. |
| 2 | **Schemas.** Zod schemas for `ExtractionResult`, `RateQuote`, `AgentOutput`. | Unit: a valid object parses, an invalid one throws. | The data contracts as code. |
| 3 | **Rate card + engine.** Static card (`ASSUMPTIONS.md` A1–A9) + pure `priceQuote()`. | **T4** (exact totals: 6,930 / 2,770 / 9,890 / 3,520) **and T5** (unknown key never fabricates). | Deterministic pricing. |
| 4 | **Escalation gate.** Pure function `decide(extraction) -> {decision, reason}`. | **T6, T7, T8** (missing field / OOS lane / OOS mode) **and T9** (quote when in-scope) — driven by hand-built `ExtractionResult` inputs, no LLM yet. | Deterministic routing. |
| 5 | **Extraction step (LLM).** System prompt (untrusted-body framing + canary), temp 0, structured output → `ExtractionResult`. | **T1, T2, T3** against fixtures 01,02,03,08 (required-field accuracy + optional-null + noise). | The first LLM boundary. |
| 6 | **Injection guard.** Code-side corroboration: canary-leak scan + "quoted total must equal engine total for the real lane." | **T12** (fixture 07: flag set, €1 not quoted, no canary leak). | Safety guard. |
| 7 | **Draft step (LLM).** Given the computed `RateQuote`, produce `{subject, body}` using figures verbatim; temp 0, structured. | **T10** (exact total parsed back out) **and T11** (≥6/7 quality predicates). | The second LLM boundary. |
| 8 | **CLI wiring + usage log.** `run <email-file>` threads steps 5→4→3→7, prints draft/escalation + token/cost. | **T13** (usage well-formed on both paths) **and T14** (E2E terminal behaviour on 01/04/07). | The working end-to-end demo. |
| 9 | **Eval runner + gate.** Load `evals/fixtures/*.json`, run pipeline, score vs `expected`, report, exit non-zero below threshold. | **T15** (≥ 6/8 pass; runner exits correctly). | The Phase 0 success gate. |

## Ordering rationale

- Tasks **3–4** (deterministic core) land first so the LLM steps in **5–7** plug into something
  already proven exact. This keeps the hard-to-test LLM boundaries thin.
- **6 before 7:** the injection guard must exist before drafting, so a drafted reply can never
  carry an attacker figure or a leaked canary.
- **8** only wires together already-passing units; **9** is the gate that makes "done" objective.

## Iteration discipline (per task)

1. One incomplete task. 2. Don't expand scope. 3. Smallest safe change. 4. Run its named test.
5. Fix only related errors (unrelated → note for the user). 6. Record files changed + tests run.
7. **Stop. User reviews.** Repeat.

## Definition of done (Phase 0)

- Tasks 1–9 complete, each task's named test green.
- **T15 ≥ 6/8** and **T12 must-pass** (the injection safety test ships regardless of headline count).
- `ASSUMPTIONS.md` lists every domain figure used (already seeded).
- Then: codex CLI second-opinion on the slice + first `AUDIT_LOG.md` entry, then user sign-off
  before Phase 1+ (per the canonical plan's ship gate).

## Risks specific to the build (watch during execution)

- **Extraction stability at temp 0** (T1): if a required field wobbles run-to-run, downgrade it to
  a band in `ACCEPTANCE_TESTS.md` and record why — do not paper over it.
- **Draft drifting the number** (T10): if the model ever restates a wrong total, the guard (Task 6)
  + T10 catch it; the fallback is to template the number in deterministically rather than let the
  model write it. That fallback is a documented option, not a silent default.
- **Confidence threshold tuning** (E1): 0.75 is a starting point; tune against fixtures and justify
  the band — it's an interview talking point, not a magic constant.
