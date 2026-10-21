/**
 * Default per-step model routing (D-07, revised D-31). Models are "provider/model-id" refs, so any
 * provider can be configured (llm/resolve.ts reads QUOTEAGENT_MODEL / _EXTRACT_MODEL / _DRAFT_MODEL).
 * The default is the strongest generally available Claude model for both steps; a cheaper drafting
 * model is a per-deployment choice that must pass the eval gate first. Changing any default is a
 * logged change that re-runs the golden set (ASSUMPTIONS.md E3). No sampling parameters are sent.
 */
export const EXTRACTION_MODEL = "anthropic/claude-opus-5-5";
export const DRAFT_MODEL = "anthropic/claude-opus-5-5";

export interface ModelRouting {
  extraction: string;
  draft: string;
}
export const PER_STEP_ROUTING: ModelRouting = { extraction: EXTRACTION_MODEL, draft: DRAFT_MODEL };

/** The seeded legacy production tenant (Linkport); its rate cards are read per (mode, lane). */
export const LINKPORT_TENANT_ID = "11111111-1111-4111-8111-111111111111";

/**
 * Sentinel placed in system prompts: if it appears in model output, the model leaked its instructions.
 * Per deployment (QUOTEAGENT_CANARY) — the open-source default is public and only good for the demo and
 * the recorded cassettes, whose keys include the prompt. A canary that is already present in the
 * inbound email is an echo, not a leak (run.ts), so planting it cannot block a request.
 */
export const DEFAULT_CANARY = "LINKPORT-CANARY-9F3A21";
export const SYSTEM_CANARY = process.env.QUOTEAGENT_CANARY?.trim() || DEFAULT_CANARY;
