import { RATE_CARD, type RateCard } from "./rate-card.js";
import { RateQuoteSchema, rateContainerTypeSchema, type RateQuote } from "./schemas.js";

/**
 * Deterministic pricing. The model NEVER produces a price — this pure function does, from
 * the static rate card. Whole-EUR integer arithmetic, so the result is exactly reproducible
 * (no float, no rounding band). Unknown lane/mode/container is rejected, never extrapolated.
 */

export interface PriceRequest {
  origin_port_code: string | null;
  destination_port_code: string | null;
  mode: string;
  container_type: string | null;
  container_qty: number | null;
}

/**
 * The RateEngine port (DECISION_LOG D-11). Pricing lives behind one async interface so the
 * production adapters (SupabaseTable, ExcelOnline) can swap in without touching the agent core.
 * Async because those adapters do IO; the Phase 0 `priceQuote()` becomes the synchronous
 * StaticCard adapter behind this port in 1A.2. Declaring the port has no caller changes (1A.1).
 */
export interface RateEngine {
  price(req: PriceRequest): Promise<RateQuote>;
}

/** Thrown when a request cannot be priced. The engine refuses rather than fabricate (T5). */
export class UnpriceableRequestError extends Error {
  constructor(
    public readonly reason:
      | "out_of_scope_mode"
      | "out_of_scope_lane"
      | "out_of_scope_container"
      | "invalid_quantity",
    message: string,
  ) {
    super(message);
    this.name = "UnpriceableRequestError";
  }
}

export function priceQuote(req: PriceRequest, card: RateCard = RATE_CARD): RateQuote {
  if (req.mode !== "FCL") {
    throw new UnpriceableRequestError("out_of_scope_mode", `mode '${req.mode}' is not priceable (FCL only)`);
  }

  const lane = `${req.origin_port_code ?? "?"}-${req.destination_port_code ?? "?"}`;
  if (lane !== card.supported_lane) {
    throw new UnpriceableRequestError("out_of_scope_lane", `lane '${lane}' is not in the rate card`);
  }

  const parsedType = rateContainerTypeSchema.safeParse(req.container_type);
  if (!parsedType.success) {
    throw new UnpriceableRequestError(
      "out_of_scope_container",
      `container_type '${req.container_type}' is not priceable`,
    );
  }

  if (req.container_qty === null || !Number.isInteger(req.container_qty) || req.container_qty < 1) {
    throw new UnpriceableRequestError("invalid_quantity", `container_qty '${req.container_qty}' is invalid`);
  }

  const containerType = parsedType.data;
  const base = card.base_per_container[containerType];
  if (base === undefined) {
    throw new UnpriceableRequestError(
      "out_of_scope_container",
      `container_type '${containerType}' is not priced on lane '${card.supported_lane}'`,
    );
  }
  const surchargeSum = card.surcharges.reduce((sum, s) => sum + s.amount_per_container, 0);
  const perShipmentSum = card.per_shipment_fees.reduce((sum, f) => sum + f.amount, 0);
  const all_in_total = req.container_qty * (base + surchargeSum) + perShipmentSum;

  // Parse through the schema so the engine's output is schema-guaranteed (ties Task 2 + 3).
  return RateQuoteSchema.parse({
    currency: "EUR",
    lane: card.supported_lane,
    rate_card_version: card.version,
    container_type: containerType,
    container_qty: req.container_qty,
    base_per_container: base,
    surcharges: card.surcharges,
    per_shipment_fees: card.per_shipment_fees,
    all_in_total,
    validity_through: card.validity_through,
  });
}

/**
 * StaticCard adapter (1A.2): the Phase 0 in-repo rate card behind the RateEngine port. `price()`
 * wraps the synchronous `priceQuote()` unchanged, so its output is byte-identical to Phase 0
 * (proven by P-1A.2). The card is injectable, defaulting to the in-repo RATE_CARD.
 */
export class StaticCardRateEngine implements RateEngine {
  constructor(private readonly card: RateCard = RATE_CARD) {}

  async price(req: PriceRequest): Promise<RateQuote> {
    return priceQuote(req, this.card);
  }
}
