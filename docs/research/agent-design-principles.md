# Agent design principles & QuoteAgent scorecard (research 2026-10-21)

Sources: Anthropic engineering ("Building effective agents", "Effective context engineering", "Writing
effective tools for agents", "Multi-agent research system", "Demystifying evals for AI agents", "Harness
design for long-running apps", "Claude Code auto mode", "How we contain Claude"), OpenAI "A practical guide
to building agents", Microsoft agent design patterns (2026), AWS Agentic AI Lens + multi-tenant agentic
guidance, HumanLayer 12-Factor Agents, OWASP LLM Top 10 2025 + Agentic Top 10 2026, Beurer-Kellner et al.
2025 (injection design patterns), CaMeL, Willison's lethal trifecta / Meta Rule of Two, MCP security best
practices, τ-bench (pass^k), LLM-as-judge bias papers, verbalized-confidence calibration (ICLR 2026),
OTel GenAI semantic conventions (moved to their own repo, still "Development").

## Scorecard at the start of the rebuild (10 strong · 11 partial · 4 missing)
| # | Principle | Then | Platform move |
|---|---|---|---|
| P1 | Least agentic structure that works | Strong | Tenders + clarification stay workflows; one bounded loop (mapping) |
| P2 | Own the control flow; model is a function | Strong | Run as reducer over events |
| P3 | Code owns decisions that must be correct | Strong | FX, margin, tender lines as versioned policy |
| P4 | Smallest high-signal context | Partial | Prompt registry with versions + tenant overlays |
| P5 | Strip untrusted text after use | Strong | Same for clarification replies |
| P6 | Few namespaced tools, actionable errors | Missing | `rates.*`/`quote.*` tools returning {status, summary, next_actions} |
| P7 | Bound every loop | Missing | Iteration + token + time caps, then escalate |
| P8 | Never combine private data + untrusted input + outbound unsupervised | Strong | Templated clarification outbound |
| P9 | Provable isolation over detection | Partial | Email-derived strings fill template slots only |
| P10 | Least privilege; credentials out of reach | Partial | Tenant-scoped short-lived worker tokens |
| P11 | Layered input/output/action checks | Strong | Output policy for links, phones, bank details |
| P12 | Autonomy graded by risk, earned by measurement | Partial | L0 shadow · L1 approve · L2 auto-send per tenant × lane |
| P13 | Design against rubber-stamp approval | Partial | Per-line sources, low-confidence highlights, fast-approval alerts |
| P14 | Durable execution, idempotent side effects | Strong | Append-only run events; waitpoint keys per round |
| P15 | Fail closed with typed reasons; contain cascades | Strong | Circuit breaker + provider fallback |
| P16 | Eval-first from real failures | Partial | 40+ fixtures from reviewer corrections; capability vs regression suites |
| P17 | Reliability as pass^k | Missing | k=5; safety fixtures must pass 5/5 |
| P18 | LLM judges only when calibrated | Strong (avoided) | Calibrate any tone judge against reviewers |
| P19 | Standard traces | Partial | OTel GenAI → Langfuse; prompt/model/policy/tenant tags |
| P20 | Cost per successful outcome | Partial | Per-tenant budgets; Batches for tenders/evals |
| P21 | Explicit state, scoped memory | Strong | Tenant memory as reviewed facts with provenance |
| P22 | Tenant identity from auth, enforced by infra | Partial | Tokens end to end; per-tenant queues/budgets; regional cells |
| P23 | Policy-as-code at every action | Missing | Per-tenant policy file at send / connector write / MCP call |
| P24 | Corrections drive learning; calibrated confidence | Partial | Structured edit diffs → evals + calibration |
| P25 | Version everything; staged rollout | Partial | Prompt hash per run; shadow → canary → full |

## Ten signature moves
1. Every number has a receipt (rate row, snapshot, mapping version, FX, confirmer); drafts use `{{slots}}` filled by code.
2. Tenders: code plans, an isolated tool-less extraction per lane, code reduces (a poisoned row spoils only its lane).
3. Clarification from a fixed list of missing fields via templates; replies go back through quarantined extraction; ≤2 rounds.
4. Rate-sheet mapping is the one bounded agent loop: read-only tools, caps, zero-diff round-trip acceptance, human confirm.
5. Reviewer-edit flywheel → curated regression fixtures + per-tenant style examples (no fine-tuning).
6. Calibrated confidence (fitted on reviewer outcomes) gates autonomy; any guard trip demotes the lane.
7. pass^5 release gate on any prompt/model/engine/policy change; report cost per successful quote.
8. Per-tenant policy-as-code (Microsoft Agent Governance SDK behind our own port; fail closed; decision recorded).
9. Tenant identity bound end to end (workers, MCP audience-bound tokens, queues, budgets, residency cells).
10. Event-sourced runs, replayable from recorded model outputs.

## Anti-patterns ruled out
LLM arithmetic/FX/margin · detectors as the boundary · free-text outbound clarifications · tenant isolation
by prompt or service-role convention · one global queue/key · open-ended agents for tenders/mapping · tool
zoos · self-reported confidence as probability · single-run release gates · uncalibrated self-grading judges ·
silent prompt/model swaps · memory written straight from email · full prompt capture in traces by default ·
auto-training on unreviewed edits · multi-agent for prestige · rubber-stamp approval UIs.
