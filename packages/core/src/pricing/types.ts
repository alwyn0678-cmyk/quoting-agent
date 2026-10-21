import type { Dec } from "../money/dec.js";
import type { Money, Currency } from "../money/money.js";
import type { FxReceipt } from "../money/fx.js";
import type { IsoType } from "../places/equipment.js";
import type { ChargeBasis, ChargeCategory, TariffMode } from "../tariff/model.js";
import type { Quantities } from "../modes/modes.js";

/** Everything needed to reproduce one line from the tariff snapshot alone. */
export interface ChargeReceipt {
  tariff_id: string;
  tariff_version: string;
  content_hash: string;
  /** null for engine-generated margin lines. */
  rate_line_id: string | null;
  charge_id: string;
  source_ref: string | null;
  margin_rule_id: string | null;
  rounding: "HALF_AWAY_FROM_ZERO";
}

export interface ChargeLine {
  id: string;
  code: string;
  description: string;
  category: ChargeCategory | "MARGIN";
  basis: ChargeBasis | "MARGIN";
  equipment: IsoType | null;
  qty: Dec;
  rate: Dec;
  /** Cost (BUY offers); null for SELL tariffs and margin lines. Never sent to browsers. */
  buy: Money | null;
  sell: Money;
  clamped: "min" | "max" | null;
  receipt: ChargeReceipt;
}

export interface Leg {
  mode: TariffMode;
  origin: string;
  destination: string;
  quantities: Quantities;
  lines: ChargeLine[];
}

export interface RouteOption {
  id: string;
  offer_key: string;
  carrier: string;
  tariff_id: string;
  price_kind: "BUY" | "SELL";
  legs: Leg[];
  /** Shipment-level, engine-generated lines (MARGIN_FLAT, MARGIN_ADJ). */
  adjustments: ChargeLine[];
  totals: { by_currency: Money[]; quote: Money };
  fx_conversions: FxReceipt[];
  transit_days: number | null;
  valid_until: string;
}

export interface PricingTrace {
  as_of: string;
  pricing_date: string;
  considered: number;
  excluded: { key: string; reason: string }[];
  margin_rule_ids: string[];
  fx_age_days: number | null;
}

export type UnpriceableReason =
  | "out_of_scope_mode"
  | "missing_required_field"
  | "out_of_scope_lane"
  | "out_of_scope_container"
  | "rate_expired"
  | "ambiguous_request"
  | "tariff_config_error"
  | "pricing_capacity_exceeded"
  | "fx_invalid"
  | "fx_missing_rate";

export type PricingResult =
  | { kind: "priced"; quote_currency: Currency; candidates: RouteOption[]; presented: string[]; trace: PricingTrace }
  | { kind: "unpriceable"; reason: UnpriceableReason; detail: string; trace: PricingTrace };
