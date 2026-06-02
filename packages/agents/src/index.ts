/**
 * Public API for the QuoteAgent Phase 0 slice. The CLI (apps/cli) depends only on this barrel.
 */
export const SLICE_ID = "phase-0" as const;

export { runAgent } from "./agent.js";
export { AnthropicLlmClient } from "./llm.js";
export type { LlmClient } from "./llm.js";
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
