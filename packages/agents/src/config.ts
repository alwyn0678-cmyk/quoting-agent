/**
 * Per-step model routing (D-07). Extraction is ambiguity/security-sensitive → the stronger model;
 * drafting is constrained prose over already-verified figures → the cheaper/faster one. Changing
 * any id is a logged change that re-runs the golden set. These are Phase-1 routing targets — VERIFY
 * against the live model list before relying on them (ASSUMPTIONS.md E3). No `temperature` is sent
 * for any model (Opus 4.8 deprecates it and determinism never relied on it).
 */
export const EXTRACTION_MODEL = "claude-sonnet-4-6";
export const DRAFT_MODEL = "claude-haiku-4-5-20251001";
/** Single-model fallback: one model for both steps when per-step routing is disabled. */
export const FALLBACK_MODEL = "claude-sonnet-4-6";

export interface ModelRouting {
  extraction: string;
  draft: string;
}
export const PER_STEP_ROUTING: ModelRouting = { extraction: EXTRACTION_MODEL, draft: DRAFT_MODEL };
export const SINGLE_MODEL_ROUTING: ModelRouting = { extraction: FALLBACK_MODEL, draft: FALLBACK_MODEL };

/** The seeded demo tenant (1B.2) the SupabaseTable adapter reads. The card's lane is resolved
 * per-request now (D-30), so there is no fixed default lane. */
export const LINKPORT_TENANT_ID = "11111111-1111-4111-8111-111111111111";

/**
 * Sentinel placed in system prompts. It must NEVER appear in agent output — if it does, the
 * model has leaked its system prompt (used by the injection guard, Task 6 / test T12).
 */
export const SYSTEM_CANARY = "LINKPORT-CANARY-9F3A21";

/**
 * Placeholder Anthropic prices (USD per million tokens) for the stdout cost log. INVENTED —
 * verify against current Anthropic pricing before quoting any cost as fact (ASSUMPTIONS.md E3).
 * A single pair across all routed models — a deliberate placeholder, not per-model; per-model
 * pricing is a 1C.6 (observability) refinement.
 */
export const PRICE_INPUT_USD_PER_MTOK = 15;
export const PRICE_OUTPUT_USD_PER_MTOK = 75;

export function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  const usd =
    (inputTokens / 1_000_000) * PRICE_INPUT_USD_PER_MTOK +
    (outputTokens / 1_000_000) * PRICE_OUTPUT_USD_PER_MTOK;
  return Math.round(usd * 1_000_000) / 1_000_000; // round to micro-dollars
}

/**
 * Gemini Embedding 2 (Q3 RAG). The model-id string is a VERIFY assumption (ASSUMPTIONS.md G) —
 * confirm against Google's current API at the live smoke; it is the single place to change it.
 * 768 dims are MRL-truncated and auto-normalized by the model.
 */
export const GEMINI_EMBEDDING_MODEL = "gemini-embedding-2";
export const EMBEDDING_DIMS = 768;
/** How many corpus chunks to retrieve for grounding the draft. */
export const RAG_TOP_K = 6;
