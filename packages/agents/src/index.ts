/**
 * Public API for the QuoteAgent Phase 0 slice. The CLI (apps/cli) depends only on this barrel.
 */
export const SLICE_ID = "phase-0" as const;

export { runAgent } from "./agent.js";
// The LLM port and its adapters — any provider via "provider/model" refs (llm/resolve.ts).
export { LlmRefusalError, LlmOutputError } from "./llm.js";
export type { LlmClient, StructuredCall, StructuredResult, Usage } from "./llm.js";
export { AnthropicLlmClient } from "./llm/anthropic.js";
export { AiSdkLlmClient } from "./llm/ai-sdk.js";
export { ReplayLlmClient, RecordingLlmClient } from "./llm/replay.js";
export { createLlmFromEnv, resolveLlmFromEnv, DEFAULT_MODEL, DEMO_MODEL } from "./llm/resolve.js";
export type { CreatedLlm, ResolvedLlm } from "./llm/resolve.js";
export type { EmailInput } from "./extraction.js";
export type { AgentOutput } from "./schemas.js";
export { EXTRACTION_MODEL, DRAFT_MODEL, FALLBACK_MODEL } from "./config.js";
// The RateEngine seam (D-11) — the 1B SupabaseTable/ExcelOnline adapters implement this.
export { StaticCardRateEngine } from "./rate-engine.js";
export type { RateEngine, PriceRequest } from "./rate-engine.js";
export { SupabaseTableRateEngine, createSupabaseRateEngine } from "./supabase-rate-engine.js";
export { LINKPORT_TENANT_ID } from "./config.js";
export { SupabaseQuoteStore, quoteToRow } from "./quote-store.js";
export type { QuoteStore, QuoteRow } from "./quote-store.js";
// The scoped-RAG retrieval seam (Q3) — grounds the draft prose; env-gated + stub-safe.
export { EmptyRetriever, createKnowledgeRetrieverFromEnv } from "./knowledge-retriever.js";
export type { KnowledgeRetriever } from "./knowledge-retriever.js";
