# Blueprint from top agent repos (research 2026-10-21)

Studied by reading source (no install/execute): vercel/ai (27.4k★), mastra (29.0k), VoltAgent (10.9k),
openai-agents-js (3.9k), Trigger.dev (16.6k), Documenso (15.5k), LibreChat (46.1k), Langfuse (36.1k),
elizaOS (19.6k), anthropics/claude-quickstarts (18.9k); READMEs of n8n, Dify, Open WebUI, OpenHands,
browser-use, CrewAI, Letta, goose, Supabase, cal.diy, Cline, Continue. Flowise archived 2026-08.

## What the best repos converge on
1. **Layout:** pnpm workspaces + Turborepo + Changesets; `apps/`, `packages/`, `examples/`, `templates/`,
   docs app, `hosting/` or `docker/` + Helm. Every repo ships **AGENTS.md** (often + CLAUDE.md).
2. **Any LLM in TypeScript = the AI SDK provider spec** (Mastra wraps it, VoltAgent passes it through,
   openai-agents-js adapts its own `Model` port to it via `aisdk()`). Models configured as
   "provider/model" strings resolved from env keys. AI SDK v7: `generateText({ output: Output.object({ schema }) })`
   (`generateObject` deprecated); `NoObjectGeneratedError`; test mock `MockLanguageModelV4`.
3. **Config:** code (`defineConfig`, c12) or a versioned zod-validated YAML (LibreChat); env for secrets only.
4. **CLIs:** commander + @clack/prompts + zod.
5. **LLM tests without live calls:** Mastra's recorder replays real provider responses keyed by request
   hash (our cassettes follow this); LibreChat runs Playwright against a mock LLM.
6. **Releases:** changesets/action SHA-pinned, npm trusted publishing (`id-token: write`), zizmor audits
   workflows; CI Node matrix + typecheck + docs build + e2e.
7. **README order:** centred banner · one-line pitch · badges · Docs/Discord/Examples links · "Why" bullets
   · 1–3 command quickstart · self-host (compose, Helm, deploy buttons) · integrations · contributing ·
   star history / contributors · license · security. Some open with a "Which path is for me?" table.

## Install UX patterns worth copying
- **Langfuse:** `git clone && docker compose up` with **no `.env` required** (insecure `# CHANGEME`
  defaults, ports bound to 127.0.0.1, healthcheck-gated `depends_on`, `*_INIT_*` env for headless setup).
- **n8n:** idempotent `curl | sh` installer (refuses to clobber, prints status + upgrade/uninstall).
- **Trigger.dev:** `generate-secrets.sh` fills only missing secrets, never rotates without `--force`.
- **Documenso:** one `npm run d` (install → compose with a mail catcher → migrate → seed → dev); deploy
  buttons for Railway/Render; devcontainer.
- **Mastra:** `npm create mastra@latest` asks for the LLM provider first, then opens a local studio.

## Recommended blueprint for QuoteAgent
```
apps/      cli (bin "quoteagent": init | quote | dev | eval | doctor | seed) · web (dashboard) · docs (Fumadocs)
packages/  core (schemas, gate, engines, guards — no I/O) · llm (port + anthropic/ai-sdk/replay/mock)
           · store (ports + supabase/memory) · ingest (eml, Graph, IMAP) · config (defineConfig + env schema)
           · trigger (durable tasks) · evals (golden runner + scorers)
examples/  fixtures/emails/*.eml · cassettes/*.json · rate-cards/*
deploy/    docker/compose.yml (profiles: db, mail [Mailpit], observability) · generate-secrets.sh · helm (later)
supabase/  config.toml · migrations · seed · tests (Supabase CLI conventions)
AGENTS.md CLAUDE.md CONTRIBUTING.md SECURITY.md CODE_OF_CONDUCT.md LICENSE (MIT) .changeset/ .github/
```
- **LLM:** keep the thin `LlmClient` port; native Anthropic adapter (structured outputs, refusal →
  escalate); AI SDK adapter for everything else with providers lazily loaded; replay + mock clients;
  same zod `safeParse` after every adapter. Publish a provider × golden-set pass-band matrix.
- **Supabase vs plain Postgres:** the app relies on PostgREST RPCs, RLS on `auth.uid()`, Realtime and
  Supabase auth. Recommendation: demo tier = in-memory store, CLI only; full local = `supabase start`;
  production = Supabase Cloud or Supabase's own self-host guide. Port to plain Postgres only on demand.
- **Demo mode:** default when no provider key; recorded real model outputs for bundled examples; every
  output labelled DEMO; CI runs it as the e2e test.
- **Docs:** Fumadocs (same Next.js stack; used by vercel/ai and Documenso).
- **GitHub:** description, topics (ai-agent, freight, logistics, quoting, typescript, llm, anthropic,
  ai-sdk, supabase, structured-output, evals), 1280×640 social preview, Discussions, issue forms,
  CODEOWNERS, SECURITY.md with private reporting, Dependabot/Renovate, branch protection, changesets
  release with trusted publishing, zizmor. Keep MIT.
- **Time to first quote < 5 min:** `curl … | sh` or `npx create-quoteagent@latest` → preflight (Node 22,
  Docker only if needed) → refuse to clobber → scaffold → fill missing secrets → run a demo quote →
  optional `quoteagent dev` with Mailpit → summary with next commands. No telemetry by default
  (respect `DO_NOT_TRACK`). CI job enforces the 5-minute budget in a clean container.
