/**
 * Static mock rate card for the Phase 0 slice. Lane: Rotterdam (NLRTM) -> New York (USNYC),
 * FCL ocean, EUR.
 *
 * EVERY FIGURE BELOW IS INVENTED — see docs/ASSUMPTIONS.md A1-A9 / B1-B5. These are
 * placeholders to make the engine run, not real freight rates, and must never be presented
 * as fact. In Phase 1+ this is replaced by the forwarder's own Excel rate engine.
 */

export interface RateCard {
  version: string;
  validity_through: string; // ISO date
  supported_lane: string; // ORIGIN-DEST UN/LOCODEs
  base_per_container: Record<"20GP" | "40GP" | "40HC", number>; // whole EUR
  surcharges: { code: string; amount_per_container: number }[]; // whole EUR, per container
  per_shipment_fees: { code: string; amount: number }[]; // whole EUR, once per shipment
}

export const RATE_CARD: RateCard = {
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
