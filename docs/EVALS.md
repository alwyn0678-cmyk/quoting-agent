# EVALS.md — how this project is evaluated (a map)

> This is the orientation map. The per-criterion detail and the nondeterminism strategy live in
> `docs/ACCEPTANCE_TESTS.md` (the spec-as-tests); this page tells you **what is tested where, and why
> the layers are split that way**.

## The one idea

Model output is nondeterministic, so the suite **never asserts exact-string equality on prose**.
Determinism is bought with: no `temperature`, a pinned model id, **structured (tool-call) output** so we
assert on a normalized object, and three assertion types — *exact* (enums/codes/integers/the total),
*pass band* (fuzzy fields: "contains the key term"), *predicate* (the draft names the lane, states the
exact total, leaks no canary). The two LLM steps are judged by **outcome**, not by their intermediate
tokens. Full rules: `ACCEPTANCE_TESTS.md` → "How we handle LLM nondeterminism".

## Three layers

**1. Offline deterministic suite** — `npm test` (Vitest, **164 tests**, no keys, no network).
The hermetic core. Every port has a test double (`MockLlmClient`, `StaticCardRateEngine`,
`MockEmbeddingClient`, `InMemoryKnowledgeRetriever`), so the deterministic logic — gate, rate engine,
guards, retrieval ranking, prompt assembly — is asserted exactly, offline. This is the layer that runs
on every change and gates every commit. Covers the spec's T-series (deterministic parts) and the RAG
R1–R5.

**2. Golden-set outcome eval** — `npm run eval` (`evals/run.ts` + `evals/score.ts`, **8 fixtures**,
live LLM, needs `ANTHROPIC_API_KEY`).
Runs the *real* pipeline against 8 hand-built emails (`evals/fixtures/0N.json`: 4 quote-able, 3
escalate, 1 injection) and scores each by outcome (decision, escalation reason, quoted total, draft
fidelity, injection safety). **The Phase 0 success gate: ≥ 6/8 pass, AND fixture-07 (injection) is a
must-pass** regardless of the headline count — a leaking or €1-quoting agent does not ship
(`score.ts: PASS_GATE = 6`, `INJECTION_FIXTURE_ID`). The 6/8 band is the residual-flake budget made
explicit, not hidden.

**3. Live integration evals** — exercise the real services, each gated on the relevant env:
| Script | Proves |
|--------|--------|
| `eval:rag` (`rag-retrieval.ts`) | RAG **R6**: real Gemini retrieval surfaces the right chunk in top-3 (3/3) |
| `eval:web-ac5` | browser RLS: a signed-in user sees ONLY its tenant's requests (AC-5) |
| `eval:web-approve` | approve → simulated-send via the same RPC the dashboard uses; no send method exists (AC-6/7) |
| `eval:web-injection` | the dashboard surfaces the fixture-07 safe state (flagged, real price, no send) (AC-8) |
| `eval:web-usage` | usage is well-formed on quote AND escalate paths; `audit_log` is RLS-isolated per tenant |
| `eval:live-stores` | the real Supabase ingest/run stores enforce tenant scoping on the autonomous path |

## Why split this way

- **Layer 1 is the safety net** — fast, deterministic, no cost; it catches regressions in the logic
  that must be correct (pricing, guards, the gate invariant) without ever touching a model.
- **Layer 2 measures the thing layer 1 can't** — does the *actual model*, on realistic emails, produce
  the right *outcome*? Outcome-scoring (not field-by-field) is deliberate: a wrong extraction shows up
  as a wrong decision or total anyway.
- **Layer 3 proves the seams are really wired** — RLS, the approve RPC, the live embedding/pgvector
  path — the things a mock cannot vouch for.

## Running

```
npm test                 # layer 1 — always, no keys
npm run eval             # layer 2 — needs ANTHROPIC_API_KEY (live LLM, ~2 calls/fixture)
npm run eval:rag         # layer 3 RAG — needs GEMINI_API_KEY
npm run eval:web-*       # layer 3 browser — needs SUPABASE_URL + ANON + SERVICE_ROLE keys
```

Anything that cannot be made stable at temperature 0 is downgraded from *exact* to *band* and that
decision is recorded in `ACCEPTANCE_TESTS.md` — never silently tolerated.
