# AUDIT_LOG.md

Per-phase audit trail (self-review + codex second-opinion + reconciliation). Newest first.

---

## Phase 0 — Vertical Slice · 2026-05-29

### What was built
Tasks 1–9 of `docs/SLICE_PLAN.md`: TS+Vitest harness; Zod data contracts; deterministic rate
engine; escalation gate; LLM extraction (injectable client + mock); deterministic injection guard;
LLM draft step + total-fidelity verifier; pipeline orchestration + CLI + usage log; golden-set
scorer + live eval runner. Pinned model `claude-opus-4-8`.

### Verification
- **Offline suite:** 66 tests pass; `tsc --noEmit` clean.
- **Live eval (`npm run eval`, real Opus 4.8): 8/8 fixtures pass — GATE PASS** (≥6/8 with the
  injection fixture must-pass). First end-to-end validation against the real model.

### Gate finding during first live run (fixed)
- `claude-opus-4-8` **rejects the `temperature` parameter** (`400: temperature is deprecated for
  this model`). Removed it + its orphan constant; determinism rests on structured output +
  tolerant/pass-band assertions, not sampling. Docs corrected. Commit `c81a7d7`. Re-ran → 8/8.

### Gate 3 — self-critique (recorded at planning, confirmed here)
1. "rate tolerance" is really an exact (€0) fidelity check (deterministic pricing) — design choice.
2. Extraction stability assumed; now empirically 8/8 once but small live-variance risk remains.
3. Injection policy = quote-and-flag (less conservative than escalate-on-any-injection) — deliberate.
4. Rate engine is a static dict of invented figures — defensibility rests on architecture, not depth.
5. Canary leak detection by exact-token match is necessary-not-sufficient.

### Gate 4 — codex second-opinion (codex-cli 0.125.0, `codex exec review --base main`, read-only)
Three findings; **I reconcile: all three valid.**

- **[P1] Draft-total fidelity not enforced at runtime** — `agent.ts:57`. The injection guard
  re-derives the `RateQuote` total (always matches, same extraction) but never checks the **draft
  prose**. `verifyDraftStatesTotal()` runs only in the eval scorer, so at runtime a draft that
  restates a wrong number (e.g. EUR 1) is emitted uncaught. **AGREE — blocking.** Move the T10
  check into the runtime guard; fail closed if the draft body omits the computed total.
- **[P1] Canary not redacted from `AgentOutput`** — `agent.ts:71`. If the model leaks the canary
  into an extraction field, it survives in the output: the guard runs only on the quote path and
  only nulls quote/draft (not extraction), and gate-escalations skip the guard entirely. codex
  demonstrated both paths leaving `commodity = LINKPORT-CANARY-…` in the output. **AGREE —
  blocking.** Scan the full assembled output for the canary on **all** paths; redact + fail closed.
- **[P2] `</email>` delimiter injection** — `extraction.ts:57`. A body containing `</email>` closes
  the untrusted-data block early, letting attacker text appear outside it. **AGREE — fix.** Escape
  the delimiter in the body (or use an unsupplied delimiter).

### Decision
All three are core to the injection-resistance + rate-fidelity story (the "no hand-waving" goal),
and all are small. Plan: fix the two P1s + the P2 before Phase 0 sign-off, re-run offline suite +
live eval (must stay ≥6/8 with injection must-pass), then update this entry with the resolution.

### Resolution — all three fixed (2026-05-29)
- **[P1] draft-total fidelity** — the injection guard now runs `verifyDraftStatesTotal` at runtime
  (new `draft_total_mismatch` violation); a number-drifting or injected total fails closed before
  any reply is shown.
- **[P1] canary redaction** — `runAgent` now scans the full assembled output for the canary on
  EVERY path (incl. gate-escalations that skip the guard); any leak is redacted to `[REDACTED]`
  and the result fails closed to `guard_violation`. Both leak paths codex demonstrated are tested.
- **[P2] delimiter injection** — the email from/subject/body are HTML-escaped before the `<email>`
  block, so the content cannot close it.
- **Verification:** offline **70/70** (+4 new tests), typecheck clean, **live eval still 8/8 GATE PASS**.

### ASSUMPTIONS status
All domain figures remain INVENTED placeholders, logged in `docs/ASSUMPTIONS.md`; none verified.

### Sign-off
Ready — all Gate-4 blocking items resolved and re-verified (offline 70/70, live 8/8 GATE PASS).
Awaiting Alwyn's Phase 0 approval before Phase 1+ (Stage 1) kicks off.
