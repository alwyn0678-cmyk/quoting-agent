import type { PricingContext } from "../../../core/src/pricing/engine.js";
import type { TenantPresentation } from "../../../core/src/draft/render.js";
import { readMockWorld, tenantRuntime, mockWorldSource, type TenantRuntime } from "../mock-world/load.js";
import { legacyStaticSource, type TariffSource } from "../sources/tariff-source.js";
import { LINKPORT_TENANT_ID } from "../config.js";

/**
 * Everything the pipeline needs to know about the forwarder it quotes for: identity (tariff scope),
 * TRUSTED presentation (admin-authored) and the pricing context for a given as-of date. P3 loads this
 * from the tenant's settings; P1a has two kinds: the legacy production tenant and the mock world.
 */
export interface TenantConfig {
  id: string;
  presentation: TenantPresentation;
  pricing(asOf: string): PricingContext;
}

/**
 * The legacy production tenant (Linkport, seeded in Supabase). Its rate cards are SELL rates in EUR,
 * so no margin rules and no FX are needed. Quote validity = min(card validity, as_of + 14 days)
 * (ASSUMPTIONS.md H — quote validity default).
 */
export function legacyTenantConfig(tenantId: string = LINKPORT_TENANT_ID): TenantConfig {
  return {
    id: tenantId,
    presentation: {
      name: "Linkport Forwarders BV",
      locale: "en-GB",
      signature: "Kind regards,\nLinkport Forwarders BV\nRotterdam, the Netherlands",
      terms_ref: null,
      carrier_labels: {},
    },
    pricing: (as_of) => ({
      as_of,
      quote_currency: "EUR",
      max_options: 3,
      quote_validity_days: 14,
      fx: null,
      margin_rules: [],
    }),
  };
}

export function fromMockRuntime(rt: TenantRuntime): TenantConfig {
  return { id: rt.tenant.id, presentation: rt.presentation, pricing: rt.context };
}

/** A mock-world tenant by id (linkport, elbkai, prairiegate, lumenstrait, kopjeveld, ventoleste). */
export function mockTenantConfig(id: string): TenantConfig {
  return fromMockRuntime(tenantRuntime(readMockWorld(), id));
}

/** Offline setups by name (CLI, evals): "legacy" = the Linkport demo rate card; otherwise a mock-world
 *  forwarder priced from the committed mock-world tariffs. */
export function offlineTenant(name: string): { tenant: TenantConfig; tariffs: TariffSource } {
  if (name === "legacy") return { tenant: legacyTenantConfig(), tariffs: legacyStaticSource(LINKPORT_TENANT_ID) };
  const world = readMockWorld();
  return { tenant: fromMockRuntime(tenantRuntime(world, name)), tariffs: mockWorldSource(world) };
}
