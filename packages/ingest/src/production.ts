import type { SupabaseClient } from "@supabase/supabase-js";
import type { LlmClient } from "../../agents/src/llm.js";
import type { ModelRouting } from "../../agents/src/config.js";
import { SupabaseLegacyTariffSource } from "../../agents/src/sources/tariff-source.js";
import { legacyTenantConfig } from "../../agents/src/pipeline/tenant.js";
import type { RunDeps } from "./run.js";

/**
 * The production run dependencies for one tenant — the single place the Trigger.dev run task and the
 * operator scripts (poll_once, ingest_email) get them from, so they can never price differently:
 * the tenant's live rate cards via the atomic get_rate_card RPC, and the tenant's configuration.
 */
export function productionRunDeps(client: SupabaseClient, tenantId: string, llm: { client: LlmClient; routing: ModelRouting }): RunDeps {
  return {
    llm: llm.client,
    routing: llm.routing,
    tariffs: new SupabaseLegacyTariffSource(client),
    tenant: legacyTenantConfig(tenantId),
  };
}
