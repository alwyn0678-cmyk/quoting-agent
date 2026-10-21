import type { Usage } from "../llm.js";

/**
 * Published per-token prices (USD per million tokens) for models we can price honestly. Source:
 * Anthropic first-party API pricing as cached 2026-10-06 (ASSUMPTIONS.md E3 — re-verify before quoting
 * cost as fact). Haiku 5.5 is the ≤100K-token prompt tier. Any model not listed returns null: the
 * usage log says "unknown" instead of inventing a number.
 */
const USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "anthropic/claude-fable-5-1": { input: 10, output: 50 },
  "anthropic/claude-opus-5-5": { input: 4, output: 20 },
  "anthropic/claude-opus-5": { input: 5, output: 25 },
  "anthropic/claude-opus-4-8": { input: 5, output: 25 },
  "anthropic/claude-sonnet-5-5": { input: 2, output: 10 },
  "anthropic/claude-sonnet-5": { input: 2, output: 10 },
  "anthropic/claude-sonnet-4-6": { input: 3, output: 15 },
  "anthropic/claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "anthropic/claude-haiku-4-5": { input: 1, output: 5 },
};

/** USD cost of one call, or null when the model's price is not known. Rounded to micro-dollars. */
export function estimateStepCostUsd(modelRef: string, usage: Usage): number | null {
  const price = USD_PER_MTOK[modelRef];
  if (!price) return null;
  const usd = (usage.input_tokens / 1_000_000) * price.input + (usage.output_tokens / 1_000_000) * price.output;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/** Sum of step costs; null if any step's price is unknown (a partial sum would understate). */
export function sumCosts(costs: (number | null)[]): number | null {
  if (costs.some((c) => c === null)) return null;
  return Math.round((costs as number[]).reduce((a, b) => a + b, 0) * 1_000_000) / 1_000_000;
}
