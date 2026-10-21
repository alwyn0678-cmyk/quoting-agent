/**
 * Public API of the agent package. The pipeline (pipeline/run.ts) is the agent; everything else is a
 * port or adapter it depends on.
 */
export const SLICE_ID = "p1a" as const;

// The pipeline and its contract.
export { runAgentV2, CONFIDENCE_THRESHOLD } from "./pipeline/run.js";
export type { AgentDeps, RunOptions } from "./pipeline/run.js";
export { AgentOutputV2Schema, QuoteViewV2Schema, OutcomeDetailPublicSchema } from "./pipeline/output.js";
export type { AgentOutputV2, QuoteViewV2, OutcomeDetailPublic } from "./pipeline/output.js";
export type { EmailInput } from "./pipeline/extract.js";
export { legacyTenantConfig, mockTenantConfig, offlineTenant } from "./pipeline/tenant.js";
export type { TenantConfig } from "./pipeline/tenant.js";
// The tariff port and its sources.
export { StaticTariffSource, SupabaseLegacyTariffSource, TariffConfigError, legacyStaticSource } from "./sources/tariff-source.js";
export type { TariffSource, TariffQuery } from "./sources/tariff-source.js";
// The LLM port and its adapters — any provider via "provider/model" refs (llm/resolve.ts).
export { LlmRefusalError, LlmOutputError } from "./llm.js";
export type { LlmClient, StructuredCall, StructuredResult, Usage } from "./llm.js";
export { AnthropicLlmClient } from "./llm/anthropic.js";
export { AiSdkLlmClient } from "./llm/ai-sdk.js";
export { ReplayLlmClient, RecordingLlmClient } from "./llm/replay.js";
export { createLlmFromEnv, resolveLlmFromEnv, DEFAULT_MODEL, DEMO_MODEL } from "./llm/resolve.js";
export type { CreatedLlm, ResolvedLlm } from "./llm/resolve.js";
export { EXTRACTION_MODEL, DRAFT_MODEL, LINKPORT_TENANT_ID } from "./config.js";
// The legacy rate engine: the parity oracle for the pricing core (sources/legacy-card.test.ts).
export { StaticCardRateEngine } from "./rate-engine.js";
export type { RateEngine, PriceRequest } from "./rate-engine.js";
