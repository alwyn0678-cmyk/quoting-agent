/** Pinned model + sampling for all LLM calls (confirmed 2026-05-29). */
export const MODEL = "claude-opus-4-8";
export const TEMPERATURE = 0;

/**
 * Sentinel placed in system prompts. It must NEVER appear in agent output — if it does, the
 * model has leaked its system prompt (used by the injection guard, Task 6 / test T12).
 */
export const SYSTEM_CANARY = "LINKPORT-CANARY-9F3A21";
