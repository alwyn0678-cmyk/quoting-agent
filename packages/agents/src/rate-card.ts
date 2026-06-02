/**
 * Static mock rate card for the Phase 0 slice. Lane: Rotterdam (NLRTM) -> New York (USNYC),
 * FCL ocean, EUR.
 *
 * EVERY FIGURE BELOW IS INVENTED — see docs/ASSUMPTIONS.md A1-A9 / B1-B5. These are
 * placeholders to make the engine run, not real freight rates, and must never be presented
 * as fact. In Phase 1+ this is replaced by the forwarder's own Excel rate engine.
 */

export interface RateCard {
  mode: string; // transport mode this card prices (FCL, BARGE, RAIL, …)
  version: string;
  validity_through: string; // ISO date
  supported_lane: string; // ORIGIN-DEST UN/LOCODEs
  base_per_container: Partial<Record<"20GP" | "40GP" | "40HC" | "45HC", number>>; // whole EUR; a card need not price every type
  surcharges: { code: string; amount_per_container: number }[]; // whole EUR, per container
  per_shipment_fees: { code: string; amount: number }[]; // whole EUR, once per shipment
}

export const RATE_CARD: RateCard = {
  mode: "FCL",
  version: "2026-06-v1",
  validity_through: "2026-06-30",
  supported_lane: "NLRTM-USNYC",
  base_per_container: { "20GP": 1800, "40GP": 2400, "40HC": 2550 }, // A1-A3
  surcharges: [
    { code: "BAF", amount_per_container: 320 }, // A4 Bunker Adjustment Factor
    { code: "THC_RTM", amount_per_container: 225 }, // A5 origin terminal handling
    { code: "THC_NYC", amount_per_container: 290 }, // A6 destination terminal handling
    { code: "ISPS", amount_per_container: 25 }, // A7 security
  ],
  per_shipment_fees: [
    { code: "DOC", amount: 65 }, // A8 documentation / B/L
    { code: "EXPORT_CUSTOMS", amount: 45 }, // A9 origin export customs handling
  ],
};

/** Pricing basis per mode. per_container is implemented; the others are reserved for later modes. */
export type PricingBasis = "per_container" | "per_chargeable_kg" | "per_ldm";
export const MODE_BASIS: Record<string, PricingBasis> = {
  FCL: "per_container",
  BARGE: "per_container",
  RAIL: "per_container",
  AIR: "per_chargeable_kg",
  TRUCK: "per_ldm",
};
/** Bases the engine can actually price today. Air/truck land here when those modes are built. */
const IMPLEMENTED_BASES = new Set<PricingBasis>(["per_container"]);
/** A mode is priceable iff it maps to a basis AND that basis is implemented. */
export function isPriceableMode(mode: string): boolean {
  const basis = MODE_BASIS[mode];
  return basis !== undefined && IMPLEMENTED_BASES.has(basis);
}
