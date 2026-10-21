import type { SupabaseClient } from "@supabase/supabase-js";
import type { LlmClient } from "../../agents/src/llm.js";
import type { ModelRouting } from "../../agents/src/config.js";
import { SupabaseLegacyTariffSource } from "../../agents/src/sources/tariff-source.js";
import { legacyTenantConfig } from "../../agents/src/pipeline/tenant.js";
import { LINKPORT_TENANT_ID } from "../../agents/src/config.js";
import type { RunDeps } from "./run.js";

/**
 * The production run dependencies for one tenant — the single place the Trigger.dev run task and the
 * operator scripts (poll_once, ingest_email) get them from, so they can never price differently:
 * the tenant's live rate cards via the atomic get_rate_card RPC, and the tenant's configuration.
 */
export function productionRunDeps(client: SupabaseClient, tenantId: string, llm: { client: LlmClient; routing: ModelRouting }): RunDeps {
  // The only configured production tenant until per-tenant settings (P3): any other tenant would be
  // quoted under Linkport's name and signature, so it is refused rather than mis-signed.
  if (tenantId !== LINKPORT_TENANT_ID) {
    throw new Error(`no tenant configuration for ${tenantId} — per-tenant presentation and pricing settings arrive in P3`);
  }
  return {
    llm: llm.client,
    routing: llm.routing,
    tariffs: new SupabaseLegacyTariffSource(client),
    tenant: legacyTenantConfig(tenantId),
  };
}
