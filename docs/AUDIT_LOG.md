# AUDIT_LOG.md

Per-phase audit trail (self-review + codex second-opinion + reconciliation). Newest first.

---

## Stage 2 — Context / Autonomy / Plan (Phase 1+) · 2026-05-29

### What was produced
`CONTEXT.md` (per-agent prompts + model routing D-07, the tool/RAG stance, least-context data scope,
and the concrete Linkport rate-engine schema mapping the Phase 0 static card to `rate_cards` /
`rate_card_lines` rows), `AUTONOMY.md` (action whitelist W1–W6, refuse-list R1–R8, HITL gates G1–G3,
kill switch K1–K3 — each tied to an enforcing mechanism + a proving test), `IMPLEMENTATION_PLAN.md`
(1A/1B/1C, one task per iteration, each naming its proving test — AC-1…AC-8 + task-local P-tests).
No code changed. Branch `phase-1-context`.

### Gate 3 — self-critique
- Drafted the three docs directly (single coherent voice, full repo + code context), then put the
  **verification** through a multi-agent adversarial audit rather than fanning out authorship.
- Grounded CONTEXT's data-scope + schema claims in the real code (`draft.ts` DraftInput, `rate-card.ts`
  codes) *before* writing them — which is exactly where the seed-code defect was later caught.

### Gate 4a — multi-agent adversarial audit (Claude workflow; 4 lenses × 2 skeptic verifications/finding)
14 raw findings → **11 confirmed** (each survived ≥1 independent refutation attempt); 3 refuted (the
canary "every path", the AC-7 split-citation, an Excel read/write framing — all correctly refuted as
misreads; I agree). Confirmed + fixed:
- **[P1] `service_role` bypasses RLS** — R6/W4 rewritten: the autonomous path's isolation is
  code-level `tenant_id` scoping (new test **P-TENANT**), not RLS/AC-5 (which covers the browser path).
- **[P1] 1A.2 cited AC-3** before the SupabaseTable adapter exists → **P-1A.2** refactor-equivalence.
- **[P1/P2] seed codes ≠ StaticCard codes** (`THC_ORIGIN/THC_DEST/DOC_BL`) → `THC_RTM/THC_NYC/DOC`
  + a note that `BASE_*` codes are internal (never emitted into `RateQuote`), so AC-3 parity holds.
- **[P2]** the "eval stays 8/8" criterion → **≥6/8** (matches T15/AC-2). **[P2]** R7 read-only →
  no-write-method (**P-EXCEL-RO**). **[P2]** unproven task halves → **P-1B.5** (read), **P-1C.3**
  (render). **[P3]** model-id format → a VERIFY note on the Sonnet-alias / Haiku-snapshot asymmetry.

### Gate 4b — codex external second-opinion (codex-cli, `review` read-only vs main) — 2 rounds
- **R1 — 6 findings, all valid.** The tenant trio deepened the `service_role` theme: **[P1]**
  `rate_card_lines` is parent-join scoped (no `tenant_id`); **[P1]** the poll re-enqueue *reads*
  rows; **[P1]** approve needs tenant authorization → new **P-APPROVE-AUTH**. Plus **[P2]** prove the
  requested Graph scopes exclude `Mail.Send`; **[P2] D-07 routing had no covering task** → added
  **1A.3**; **[P2]** codex pushed *against* the workflow's 8/8→≥6/8 fix.
- **Reconciling the one conflict (workflow coh-2 vs codex-6):** both are right about different things.
  Behaviour-unchanged for the *deterministic* refactor is proven exactly by **P-1A.2**; the *live eval*
  is nondeterministic, so its binding gate is **≥6/8** (8/8 expected). The plan now states both
  separately — ≥6/8 no longer masquerades as the parity proof, and 8/8 is not asserted as a hard
  pass/fail on LLM output.
- **R2 — no new contradictions or autonomy/security gaps; AC-1…AC-8 all covered.** Two
  test-completeness items only (prove the Sonnet fallback; prove `createDraft` positively) — applied.

### Decision — codex loop capped at R2
Findings converged from R1 contradictions + coverage gaps (incl. **3 P1 tenant-isolation defects**) to
R2 "add one more unit assertion", with **no contradictions remaining and full AC-1…AC-8 coverage**.
The residual items are unit-test detail, proven when the code is written (1A–1C), not gating the spec.

### Sign-off
Ready — the three Stage-2 docs are coherent with the signed-off specs and the real Phase 0 code, and
the sharpest finding (the `service_role`/RLS isolation gap) is now an **explicit, tested** control
(P-TENANT / P-APPROVE-AUTH). **Approved by Alwyn 2026-05-29; `phase-1-context` merged to `main`
(`--no-ff`).** Building Phase 1A next — one task at a time, each proving its named test.

---

## Stage 1 — Specification (Phase 1+) · 2026-05-29

### What was produced
`ARCHITECTURE.md` (Option C — hybrid pipeline + swappable `RateEngine` port), `PRD.md`, `SPEC.md`
(flows + Supabase data model + AC-1…AC-8), `DECISION_LOG.md` (D-01…D-16). Four open questions
resolved: poll ingest (D-13), simulated send (D-14), single-tenant + `tenant_id`/RLS seam (D-15),
versioned rate cards + quote snapshots (D-16). No code changed.

### Gate 3 — self-critique
- ARCHITECTURE was drafted before D-13/D-14 were decided, so it drifted from PRD/SPEC (caught below).
- The spec is design-forward; several Supabase/RLS/idempotency details are correct-in-principle but
  only provable when the schema is actually built (1B).

### Gate 4 — codex (codex-cli 0.125.0, `codex exec review --base main`, read-only) — 4 rounds
- **R1 (ARCHITECTURE):** [P2] webhook vs D-13 poll; [P1] real Graph send vs D-14 simulate. → fixed.
- **R2 (SPEC):** [P2] no user→tenant mapping for RLS; [P2] missing 1:1 unique keys for retry
  idempotency; [P2] injection lumped with escalation (breaks fixture-07 quote-and-flag / AC-2);
  [P3] reserved `from`. → fixed (profiles table, unique `request_id`, quote-and-flag wording, `from_email`).
- **R3 (SPEC):** [P2] self-referential RLS recursion. → fixed (`profiles` direct policy + SECURITY
  DEFINER `auth_tenant_id()`).
- **R4 (SPEC):** [P2] `rate_card_lines` lacks tenant scope; [P2] poll can strand a message if enqueue
  fails after insert. → fixed (parent-join RLS for lines; re-enqueue stuck `received` requests).

### Decision — codex loop capped at R4
Findings converged from contradictions (R1, blocking) to implementation-level DB/RLS/idempotency
detail (R3–R4). **No contradictions remain.** Remaining fine-grained schema concerns are re-reviewed
when the migration is actually written (Stage 1B), not gating the Stage-1 spec.

### Sign-off
Ready — Stage 1 spec coherent, all contradictions resolved. **Approved by Alwyn 2026-05-29;
`phase-1-spec` merged to `main` (`--no-ff`).** Stage 2 (CONTEXT.md / AUTONOMY.md /
IMPLEMENTATION_PLAN) follows on its own branch.

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
