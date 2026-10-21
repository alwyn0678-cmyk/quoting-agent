import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Dec } from "../../../core/src/money/dec.js";
import { fromMajor, isCurrency, type Currency } from "../../../core/src/money/money.js";
import type { FxSnapshot } from "../../../core/src/money/fx.js";
import type { MarginRule } from "../../../core/src/margin/margin.js";
import type { PricingContext } from "../../../core/src/pricing/engine.js";
import type { TenantPresentation } from "../../../core/src/draft/render.js";
import type { ChargeCategory, TariffMode, TariffWire } from "../../../core/src/tariff/model.js";
import { StaticTariffSource } from "../sources/tariff-source.js";
import type { MockTenant, MockWorld } from "./build.js";

/** Loads the committed mock world (examples/mock-world) into a tariff source + per-tenant context. */

export const MOCK_WORLD_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples/mock-world");

export function readMockWorld(dir = MOCK_WORLD_DIR): MockWorld {
  const read = (f: string) => JSON.parse(readFileSync(resolve(dir, f), "utf8"));
  const tenants = read("tenants.json") as MockTenant[];
  const tariffs: Record<string, TariffWire[]> = {};
  for (const t of tenants) tariffs[t.id] = read(`tariffs/${t.id}.json`) as TariffWire[];
  return { readme: "", tenants, tariffs, fx: read("fx.json") };
}

export function fxSnapshot(world: MockWorld): FxSnapshot {
  const rates: Partial<Record<Currency, Dec>> = {};
  for (const [ccy, r] of Object.entries(world.fx.rates)) if (isCurrency(ccy)) rates[ccy] = Dec.parse(r);
  if (!isCurrency(world.fx.base)) throw new Error(`unsupported FX base ${world.fx.base}`);
  return { base: world.fx.base, rates, source: world.fx.source, as_of: world.fx.as_of };
}

export function marginRules(t: MockTenant): MarginRule[] {
  return t.margin_rules.map((r) => ({
    id: r.id,
    match: r.match.mode ? { mode: r.match.mode as TariffMode } : {},
    kind: r.kind,
    value: Dec.parse(r.value),
    ...(r.currency && isCurrency(r.currency) ? { currency: r.currency } : {}),
    ...(r.min_margin && isCurrency(r.min_margin.currency) ? { min_margin: fromMajor(r.min_margin.amount, r.min_margin.currency) } : {}),
    applies_to: r.applies_to === "ALL" ? "ALL" : (r.applies_to as ChargeCategory[]),
    priority: r.priority,
  }));
}

export interface TenantRuntime {
  tenant: MockTenant;
  presentation: TenantPresentation;
  context: (asOf: string) => PricingContext;
}

export function tenantRuntime(world: MockWorld, tenantId: string): TenantRuntime {
  const tenant = world.tenants.find((t) => t.id === tenantId);
  if (!tenant) throw new Error(`unknown mock-world tenant '${tenantId}' (known: ${world.tenants.map((t) => t.id).join(", ")})`);
  if (!isCurrency(tenant.quote_currency)) throw new Error(`unsupported quote currency ${tenant.quote_currency}`);
  const quote_currency = tenant.quote_currency;
  const fx = fxSnapshot(world);
  const rules = marginRules(tenant);
  return {
    tenant,
    presentation: {
      name: tenant.name,
      locale: tenant.locale,
      signature: tenant.signature,
      terms_ref: tenant.terms_ref,
      carrier_labels: tenant.carrier_labels,
    },
    context: (as_of) => ({
      as_of,
      quote_currency,
      max_options: tenant.max_options,
      quote_validity_days: tenant.quote_validity_days,
      fx,
      margin_rules: rules,
    }),
  };
}

export function mockWorldSource(world: MockWorld): StaticTariffSource {
  return new StaticTariffSource(world.tariffs);
}
