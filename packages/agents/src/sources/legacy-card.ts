import type { RateCard } from "../rate-card.js";
import type { ChargeWire, RateLineWire, TariffMode, TariffWire } from "../../../core/src/tariff/model.js";

/**
 * Legacy adapter: today's Supabase/Excel rate cards (whole-EUR, customer-facing amounts per container
 * type, per-container surcharges, per-shipment fees) → canonical tariffs, so the production path
 * prices through the new core with line-by-line parity (legacy-card.test.ts).
 *  - Lines are SELL rates (the legacy figures are customer-facing; no margin is applied).
 *  - One rate line per container type; per-shipment fees are identical on every line, so they are
 *    charged once per offer exactly as before.
 *  - Legacy cards have no start date: valid_from is the open start 2000-01-01 (ASSUMPTIONS.md H12).
 */

const ISO: Record<string, string> = { "20GP": "22G1", "40GP": "42G1", "40HC": "45G1", "45HC": "L5G1" };
export const LEGACY_VALID_FROM = "2000-01-01";

export function legacyCardToTariffWire(card: RateCard, tenantId: string): TariffWire {
  const [origin, destination] = card.supported_lane.split("-") as [string, string];
  const surcharges: ChargeWire[] = card.surcharges.map((s) => ({
    id: s.code,
    code: s.code,
    description: s.code,
    category: "SURCHARGE",
    basis: "PER_CONTAINER",
    rate: String(s.amount_per_container),
    currency: "EUR",
  }));
  const fees: ChargeWire[] = card.per_shipment_fees.map((f) => ({
    id: f.code,
    code: f.code,
    description: f.code,
    category: f.code === "DOC" ? "DOCUMENT" : "LOCAL",
    basis: "PER_SHIPMENT",
    rate: String(f.amount),
    currency: "EUR",
  }));
  const lines: RateLineWire[] = Object.entries(card.base_per_container).map(([ct, base]) => ({
    id: `legacy:${card.mode}:${card.supported_lane}:${card.version}:${ct}`,
    offer_id: "legacy-card",
    mode: card.mode as TariffMode,
    carrier: "Rate card",
    origin: { unlocode: origin },
    destination: { unlocode: destination },
    equipment: ISO[ct],
    priority: 0,
    price_kind: "SELL",
    source_ref: `rate_cards:${card.mode}:${card.supported_lane}:${card.version}:${ct}`,
    charges: [
      { id: `BASE_${ct}`, code: `BASE_${ct}`, description: "Base freight", category: "FREIGHT", basis: "PER_CONTAINER", rate: String(base), currency: "EUR" },
      ...surcharges,
      ...fees,
    ],
  }));
  return {
    id: `legacy:${tenantId}:${card.mode}:${card.supported_lane}:${card.version}`,
    tenant_id: tenantId,
    version: card.version,
    source: { kind: "legacy_rate_card", ref: `${card.mode}:${card.supported_lane}` },
    valid_from: LEGACY_VALID_FROM,
    valid_to: card.validity_through,
    port_groups: {},
    lines,
  };
}
