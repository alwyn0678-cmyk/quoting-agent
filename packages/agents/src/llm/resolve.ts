import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { LlmClient, StructuredCall, StructuredResult } from "../llm.js";
import type { ModelRouting } from "../config.js";
import { parseModelRef, type Provider } from "./model-ref.js";
import { AnthropicLlmClient, type Effort } from "./anthropic.js";
import { AiSdkLlmClient } from "./ai-sdk.js";
import { ReplayLlmClient, RecordingLlmClient } from "./replay.js";
import { resolveAiSdkModel, type Env } from "./providers.js";

/**
 * Turns environment configuration into a model routing + an LLM client:
 *   QUOTEAGENT_MODEL          model for every step (e.g. "openai/gpt-5.1", "ollama/qwen2.5:7b")
 *   QUOTEAGENT_EXTRACT_MODEL  per-step override for extraction
 *   QUOTEAGENT_DRAFT_MODEL    per-step override for drafting
 * With nothing configured and an ANTHROPIC_API_KEY present, both steps use Claude Opus 5.5. With no
 * provider at all, QuoteAgent runs in demo mode: recorded model responses for the bundled examples.
 */

export const DEFAULT_MODEL = "anthropic/claude-opus-5-5";
export const DEMO_MODEL = "demo/replay";

/** Environment variables a hosted provider needs (any one of them). Local providers need none. */
const REQUIRED_KEYS: Partial<Record<Provider, string[]>> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  google: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  azure: ["AZURE_API_KEY"],
  "openai-compatible": ["OPENAI_COMPATIBLE_BASE_URL"],
};

export interface ResolvedLlm {
  mode: "live" | "demo";
  routing: ModelRouting;
}

export function resolveLlmFromEnv(env: Env): ResolvedLlm {
  const configured = env.QUOTEAGENT_MODEL ?? (env.ANTHROPIC_API_KEY ? DEFAULT_MODEL : undefined);
  if (!configured && !env.QUOTEAGENT_EXTRACT_MODEL && !env.QUOTEAGENT_DRAFT_MODEL) {
    return { mode: "demo", routing: { extraction: DEMO_MODEL, draft: DEMO_MODEL } };
  }
  const routing: ModelRouting = {
    extraction: env.QUOTEAGENT_EXTRACT_MODEL ?? configured ?? DEFAULT_MODEL,
    draft: env.QUOTEAGENT_DRAFT_MODEL ?? configured ?? DEFAULT_MODEL,
  };
  for (const ref of [routing.extraction, routing.draft]) {
    const { provider } = parseModelRef(ref);
    const keys = REQUIRED_KEYS[provider];
    if (keys && !keys.some((k) => env[k])) {
      throw new Error(`model '${ref}' needs ${keys.join(" or ")} to be set`);
    }
  }
  // Demo replay is all-or-nothing: a mixed route would let recorded extractions reach live drafting
  // (and real mail), and would bill historical cassette usage as if it were consumed now.
  const demoSteps = [routing.extraction, routing.draft].filter((r) => parseModelRef(r).provider === "demo");
  if (demoSteps.length === 1) {
    throw new Error("demo/replay cannot be mixed with live models — use demo for every step or for none");
  }
  return { mode: demoSteps.length === 2 ? "demo" : "live", routing };
}

/** Default cassette directory: <repo>/examples/cassettes (override with QUOTEAGENT_CASSETTES). */
export function defaultCassetteDir(env: Env): string {
  return env.QUOTEAGENT_CASSETTES ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples/cassettes");
}

/** Dispatches each call to the adapter for its provider; adapters are created on first use. */
export class RoutingLlmClient implements LlmClient {
  private readonly clients = new Map<string, LlmClient>();

  constructor(
    private readonly env: Env,
    private readonly cassetteDir: string,
  ) {}

  private clientFor(provider: Provider): LlmClient {
    const key = provider === "anthropic" || provider === "demo" ? provider : "ai-sdk";
    let client = this.clients.get(key);
    if (!client) {
      if (provider === "anthropic") {
        client = new AnthropicLlmClient({
          apiKey: this.env.ANTHROPIC_API_KEY,
          effort: this.env.QUOTEAGENT_EFFORT as Effort | undefined,
          serverFallbacks: this.env.QUOTEAGENT_ANTHROPIC_FALLBACK === "1",
        });
      } else if (provider === "demo") {
        client = new ReplayLlmClient(this.cassetteDir);
      } else {
        client = new AiSdkLlmClient((ref) => resolveAiSdkModel(ref, this.env));
      }
      this.clients.set(key, client);
    }
    return client;
  }

  callStructured(call: StructuredCall): Promise<StructuredResult> {
    return this.clientFor(parseModelRef(call.model).provider).callStructured(call);
  }
}

export interface CreatedLlm extends ResolvedLlm {
  client: LlmClient;
}

/** One-call setup for every entry point (CLI, workers, scripts, evals). */
export function createLlmFromEnv(env: Env = process.env): CreatedLlm {
  const resolved = resolveLlmFromEnv(env);
  const cassetteDir = defaultCassetteDir(env);
  let client: LlmClient = new RoutingLlmClient(env, cassetteDir);
  if (env.QUOTEAGENT_RECORD === "1") {
    if (resolved.mode === "demo") throw new Error("QUOTEAGENT_RECORD=1 needs a live provider to record from");
    client = new RecordingLlmClient(client, cassetteDir);
  }
  return { ...resolved, client };
}
