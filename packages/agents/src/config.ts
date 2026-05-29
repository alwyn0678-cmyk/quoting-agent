/**
 * Pinned model for all LLM calls (confirmed 2026-05-29). Opus 4.8 deprecates the `temperature`
 * parameter (the API rejects it), so we don't send it — determinism rests on structured output
 * + tolerant/pass-band assertions, never on the sampling temperature.
 */
export const MODEL = "claude-opus-4-8";

/**
 * Sentinel placed in system prompts. It must NEVER appear in agent output — if it does, the
 * model has leaked its system prompt (used by the injection guard, Task 6 / test T12).
 */
export const SYSTEM_CANARY = "LINKPORT-CANARY-9F3A21";

/**
 * Placeholder Anthropic prices (USD per million tokens) for the stdout cost log. INVENTED —
 * verify against current Anthropic pricing before quoting any cost as fact (ASSUMPTIONS.md E3).
 */
export const PRICE_INPUT_USD_PER_MTOK = 15;
export const PRICE_OUTPUT_USD_PER_MTOK = 75;

export function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  const usd =
    (inputTokens / 1_000_000) * PRICE_INPUT_USD_PER_MTOK +
    (outputTokens / 1_000_000) * PRICE_OUTPUT_USD_PER_MTOK;
  return Math.round(usd * 1_000_000) / 1_000_000; // round to micro-dollars
}
