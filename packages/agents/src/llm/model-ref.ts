/**
 * Model references are "provider/model-id" strings, so routing is plain configuration
 * (QUOTEAGENT_MODEL=openai/gpt-5.1) rather than code. The model id keeps any further slashes,
 * which OpenRouter-style ids need ("openrouter/anthropic/claude-sonnet-5-5").
 */

export const PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "azure",
  "bedrock",
  "ollama",
  "openrouter",
  "openai-compatible",
  "demo",
] as const;
export type Provider = (typeof PROVIDERS)[number];

export interface ModelRef {
  provider: Provider;
  modelId: string;
}

/** Bare ids we can attribute to a provider without ambiguity. */
const BARE_ID_PROVIDERS: [RegExp, Provider][] = [
  [/^claude-/, "anthropic"],
  [/^(gpt-|o\d)/, "openai"],
  [/^gemini-/, "google"],
];

export function parseModelRef(ref: string): ModelRef {
  const slash = ref.indexOf("/");
  if (slash > 0) {
    const provider = ref.slice(0, slash);
    const modelId = ref.slice(slash + 1);
    if (!(PROVIDERS as readonly string[]).includes(provider)) {
      throw new Error(`unknown provider '${provider}' in model ref '${ref}' (known: ${PROVIDERS.join(", ")})`);
    }
    if (!modelId) throw new Error(`model ref '${ref}' has no model id`);
    return { provider: provider as Provider, modelId };
  }
  for (const [pattern, provider] of BARE_ID_PROVIDERS) {
    if (pattern.test(ref)) return { provider, modelId: ref };
  }
  throw new Error(`cannot infer the provider for '${ref}' — use the provider/model form, e.g. 'ollama/${ref}'`);
}

export function formatModelRef({ provider, modelId }: ModelRef): string {
  return `${provider}/${modelId}`;
}
