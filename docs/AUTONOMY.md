# AUTONOMY.md — What the agent may do, must never do, and how to stop it (Phase 1+)

> The agent is a **drafting assistant, not an autonomous actor**: it proposes, a human commits
> (D-10). This doc enumerates the autonomous-action whitelist, the hard refuse-list, the
> human-in-the-loop gates, and the kill switch — each tied to the **mechanism that enforces it**
> and the **test that proves it**, in the same one-claim-one-test discipline as the slice. The
> design property that makes all of this tractable: **no path sends anything to a customer**
> (D-14), so a misbehaving agent's blast radius is bounded to reversible database writes.

## Autonomy posture

The system runs an ingest→draft pipeline unattended, but every outward-facing or irreversible
action is either **absent by construction** (real send) or **gated on a human** (the move to
`sent`). Autonomy is granted only for actions that are internal and reversible.

## Action whitelist — may run autonomously (no human in the loop)

Each of these is internal (DB or read-only) and reaches no customer.

| # | Autonomous action | Enforcing scope / mechanism |
|---|---|---|
| W1 | Poll the watched test mailbox; **read** new messages | MS Graph **read-only** mail scope; cursor + dedup (D-13) |
| W2 | Insert a `quote_request` (dedup by `graph_message_id`); accept paste/sample input | DB write; unique index prevents duplicates |
| W3 | Run `extract → gate → price → draft → injection guard` | compute only; no external effect |
| W4 | Persist `quote`, `draft`, `audit_log`; set status `awaiting_review` / `escalated`; set `injection_flag` | DB writes as `service_role` (**RLS-bypassing**); isolation is mandatory `tenant_id` scoping in code — see R6 |
| W5 | Re-enqueue a stranded `received` request with no completed run | idempotent per `request_id` (D-13/SPEC) |
| W6 | *(optional, gated)* create an Outlook **draft** via Graph — saved, **never sent** | Graph draft-create scope only; **no send scope requested** (D-14) |

Everything W1–W6 lands a row or a saved draft. None notifies a customer.

## Refuse-list — never, in v1 (autonomously or otherwise)

| # | The agent must never… | Why it can't / mechanism | Proving test |
|---|---|---|---|
| R1 | **Send a real email** | No `send` call exists in any code path; Graph send scope is **never requested** (D-14) | **AC-7** (mocked Graph fails the test if `send` is invoked) |
| R2 | Reach `sent` / notify a customer **without explicit human approval** | `sent` is reachable **only** from the Approve action | **AC-6** |
| R3 | Quote a number the rate engine didn't compute (e.g. an injected €1) | Pricing is deterministic code; the guard re-derives the engine total and fails closed on mismatch | **T12** |
| R4 | Follow instructions embedded in an email body | Untrusted-data framing + escaped/fenced input; the **drafting model never sees the raw body**; guard corroborates | **T12** (+ CONTEXT data-scope) |
| R5 | Leak the system canary into any output | Runtime canary scan on **every** path → redact + fail-closed (D-08) | **T12** ([agent.ts](../packages/agents/src/agent.ts#L84-L94)) |
| R6 | Read or write **another tenant's** data | **Two controls, by path** (see note) — browser: RLS via `auth_tenant_id()`; autonomous `service_role`: mandatory `tenant_id` scoping in code (RLS is bypassed) | **AC-5** (browser) + **P-TENANT** (service_role path) |
| R7 | **Write** to the forwarder's Excel rate engine | Enforced like R1: the v1 Graph/Excel wrapper **exposes no write method** (only the Excel write *scope* is never requested/wired) — the eventual write capability in ARCHITECTURE is deferred behind the Week-6 gate | **P-EXCEL-RO** (no Excel-write method reachable) + Week-6 gate review |
| R8 | Auto-approve, auto-retry into a send, or escalate-then-send | No code path constructs a send; retries upsert DB rows only | **AC-6 / AC-8** |

R1/R2/R8 are the same invariant from three angles: **only a human, via Approve, moves a request to
`sent`** — and even then it is a *simulated* send.

**R6 is the one rule with no single mechanism — say so plainly.** The browser/reviewer path is
protected by RLS (`auth_tenant_id()`), proven by AC-5. But the **autonomous pipeline (W1–W6) runs
as `service_role`, which bypasses RLS by design** (SPEC.md data-model note). In that path, tenant
isolation is **not** enforced by the database — it depends on the orchestration code scoping every
read and write by `tenant_id`. A missing filter or a wrong `tenant_id` on an insert would cross
tenants and RLS would not stop it. That convention is therefore promoted to a tested control,
**P-TENANT**: the poll/run code configured for tenant A can never read or write a row carrying
another tenant's `tenant_id` (IMPLEMENTATION_PLAN 1C.1/1C.2). Two tenants are seeded for the test —
one is not enough to catch a leak.

## Human-in-the-loop gates (a person must act)

| Gate | What the human sees | What the action does | Proving test |
|---|---|---|---|
| **G1 — Approve before (simulated) send** | extraction + the **itemised deterministic breakdown** + the editable draft | sets status `sent`, records `simulated_sent_at` + intended recipient, shows a **"SIMULATED SEND"** badge; **zero** Graph send calls | **AC-6 + AC-7** |
| **G2 — Escalation handling** | the escalation reason; **no draft, no send action** | a human handles it out-of-band; v1 does **not** auto-reply asking for a missing field | **AC-8** |
| **G3 — Flagged injection review** | a normal quote + draft, shown with an **`injection_flag` badge** | the human reviews before G1 (quote-and-flag policy; the injection changed nothing) | fixture-07 / **AC-8** parity |

**The approver** is a reviewer authenticated to the request's tenant (magic-link → `profiles` →
tenant). The approve action is the single transition into `sent`; it makes no external call —
it records that a send *would* have happened.

## Kill switch — graduated stop levers

Because nothing auto-sends, stopping the agent means stopping **processing**, not stopping
**sending** — there is no in-flight customer email to claw back.

| Lever | Effect | Reversibility |
|---|---|---|
| **K1 — pause the scheduled poll** (Trigger.dev) | no new ingest; existing requests untouched | resume re-arms the poll |
| **K2 — disable the agent-run task** (`agent_enabled` flag) | in-flight runs drain; new requests sit at `received` and are re-enqueued when re-enabled (W5) | nothing lost; queue replays |
| **K3 — revoke the `service_role` key / pause the Supabase project** | hard stop on all writes (nuclear) | rotate key / unpause to restore |

**Bounded blast radius (state it plainly):** the worst case for a runaway agent is rows piling up
in `awaiting_review` / `escalated` and token spend — all reversible, none customer-visible. The
honest answer to "what if it hallucinates a quote at 3am" is **it physically cannot send one**;
the kill switch exists to stop noise and cost, not to prevent a leaked email.

## Failure modes → fail-closed (every failure resolves to a safe state)

| Failure | Resolution | Mechanism |
|---|---|---|
| Guard violation (canary leak / price mismatch / draft-total drift) | escalate; drop quote + draft | runtime injection guard (D-08) |
| LLM or Graph error / timeout | status `error`; **no partial output**; retried idempotently | Trigger.dev retry + unique `request_id` upsert |
| Missing field / out-of-scope lane or mode / low confidence | escalate with a named reason | deterministic gate |
| Ambiguous request | escalate (v1 does **not** converse with the customer) | gate + scope (SLICE out-of-scope) |

## Cross-references
- The capabilities behind W1–W6 / R1–R8 (what each agent sees and can call) → `CONTEXT.md`.
- Flows, statuses, and the data model these act on → `SPEC.md`.
- The build order that lands each gate and guard → `IMPLEMENTATION_PLAN.md`.
- Full threat model + monitoring/alerting/cost caps → `SECURITY.md` / `MONITORING.md` (Stage 3).
