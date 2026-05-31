# OBSERVABILITY.md — what the agent records about itself, and where to see it

> Two kinds of observability live in this project: **runtime** (what each agent run emits and persists —
> cost, decision, safety flags) and **process** (the human-facing audit trail of engineering decisions).
> Both are deliberate; this doc maps them. Cost figures are INVENTED placeholders (see ASSUMPTIONS E3).

## Runtime: every run is self-reporting

`runAgent` returns an `AgentOutput.usage` block on **both** the quote and escalate paths
(`agent.ts:97-105`):

```
usage = { model, input_tokens, output_tokens, est_cost_usd }
```

Three honesty properties are built in:
- **`model` reports what actually ran** — extraction-only on a gate-escalation, `extract + draft` on a
  quote (`agent.ts:99-101`). It never claims a draft model ran when drafting was skipped.
- **Tokens are summed across both LLM calls**, not estimated.
- **`est_cost_usd` is labelled invented** — `estimateCostUsd` (`config.ts`) uses placeholder Anthropic
  prices ($15 / $75 per Mtok in/out). The number is real arithmetic on real token counts, but the
  *rate* is an assumption (ASSUMPTIONS E3, VERIFY) — so the cost is honest about its own uncertainty
  rather than presented as authoritative.

## Runtime: the CLI surface (Phase 0)

`formatAgentOutput` (`apps/cli/src/format.ts`) prints, on every invocation:
- the **draft** (quote path) or the **escalation reason** (escalate path) — never a draft on escalate;
- a **provenance line** — `[quote] N x TYPE LANE — all-in EUR X (valid through …, rate card <version>)`
  — so the figure is traceable to a specific rate-card version;
- a **safety flag** — `[flag] prompt-injection detected …` when `injection_flag` is set;
- a **usage line** — `[usage] model=… in=… out=… est_cost_usd=…`.

This is the Phase 0 observability evidence: you can read cost and safety state straight off stdout.

## Runtime: persistence + the dashboard (Phase 1)

The autonomous path writes one **`audit_log`** row per run (`0001_init.sql:78`):

```
audit_log( tenant_id, request_id, event, model,
           input_tokens, output_tokens, est_cost_usd, injection_flag, created_at )
```

- **Tenant-isolated by RLS** — `audit_log_by_tenant` scopes every read to the caller's tenant
  (`0001_init.sql:155`); the dashboard never filters by tenant manually.
- **The dashboard usage view** (`apps/web/app/usage/page.tsx` → `listUsageForTenant`,
  `apps/web/src/lib/usage.ts`) reads those rows RLS-scoped and shows per-run rows plus totals (runs,
  input/output tokens, est_cost_usd). The select is column-explicit (`USAGE_SELECT`).
- **Both decision paths log** — quote and escalate alike (T13 / P-1C.6 parity), so escalations are as
  visible as quotes, not silently dropped.

## Safety as a first-class signal

Two safety states are observable, not buried:
- **`injection_flag`** — the quote-and-flag policy: an email carrying an injection attempt is still
  quoted normally (the deterministic price is unaffected) but the flag is surfaced in `AgentOutput`,
  printed by the CLI, persisted to `audit_log`, and shown in the dashboard. The operator sees that the
  inbound was adversarial without the agent having acted on it.
- **`guard_violation`** — if a safety guard trips (canary leak, price/total mismatch), the run
  fails closed: quote and draft are dropped and the run escalates with reason `guard_violation`
  (`agent.ts:78-84`). The canary net (`agent.ts:111-118`) is the last line — on *every* path it scans
  the whole output for `SYSTEM_CANARY` and redacts + escalates if it leaked. A safety failure is thus a
  visible escalation, never a silent pass.

## Process observability: the engineering audit trail

The project also makes its *own development* observable — which is part of the success metric (explain
every decision without hand-waving):
- **`AUDIT_LOG.md`** — per-phase trail: self-review (Gate-3) + codex second-opinion (Gate-4) + how each
  finding was reconciled + sign-off. You can trace why each merge was trusted.
- **`DECISION_LOG.md`** — load-bearing product/architecture decisions with rationale (D-01…D-26).
- **`ASSUMPTIONS.md`** — every invented domain figure, labelled `INVENTED`/`STRUCTURAL`/`VERIFY` with a
  verification path. Nothing domain-specific is ever stated as fact.

Runtime observability tells you what a *run* did; process observability tells you why the *system* is
the way it is. A reviewer should be able to answer both from the repo alone.
