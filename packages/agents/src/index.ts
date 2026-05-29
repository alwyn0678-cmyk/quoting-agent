/**
 * Public API for the QuoteAgent Phase 0 slice. The CLI (apps/cli) depends only on this barrel.
 */
export const SLICE_ID = "phase-0" as const;

export { runAgent } from "./agent.js";
export { AnthropicLlmClient } from "./llm.js";
export type { LlmClient } from "./llm.js";
export type { EmailInput } from "./extraction.js";
export type { AgentOutput } from "./schemas.js";
export { MODEL } from "./config.js";
