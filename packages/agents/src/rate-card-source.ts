import type { RateCard } from "./rate-card.js";

/**
 * The generic rate-card source seam, shared by every row/cell-backed RateEngine adapter
 * (SupabaseTable, ExcelOnline). A source yields the raw card + line rows for a {tenant, lane};
 * `assembleRateCard` turns them into the same in-memory RateCard the Phase 0 StaticCard uses, so
 * any adapter that delegates to `priceQuote()` produces an identical RateQuote (AC-3).
 */

/** Raw rows as stored by the 1B.1 schema (or read from any equivalent source, e.g. an Excel sheet). */
export interface RateCardRow {
  mode: string;
  version: string;
  validity_through: string; // 'YYYY-MM-DD'
  lane: string;
}
export interface RateCardLineRow {
  kind: "base" | "surcharge_per_container" | "per_shipment_fee";
  code: string;
  container_type: string | null;
  amount: number;
  sort_order: number;
}

export interface RateCardSource {
  fetchActiveCard(
    tenantId: string,
    mode: string,
    lane: string,
  ): Promise<{ card: RateCardRow; lines: RateCardLineRow[] } | null>;
}

/**
 * Assemble the in-memory RateCard from rows. surcharges / per_shipment_fees are ordered by
 * `sort_order` (within kind) so the produced arrays match the StaticCard exactly — source row order
 * is otherwise unspecified.
 */
export function assembleRateCard(card: RateCardRow, lines: RateCardLineRow[]): RateCard {
  // Fail fast on malformed source rows (hand-edited DB row, bad import): a clear, named error at
  // card-resolution time — never a raw ZodError from inside priceQuote AFTER the gate said "quote".
  if (!/^\d{4}-\d{2}-\d{2}$/.test(card.validity_through)) {
    throw new Error(
      `rate card '${card.version}' (${card.lane}): validity_through '${card.validity_through}' is not YYYY-MM-DD`,
    );
  }
  for (const l of lines) {
    if (!Number.isInteger(l.amount) || l.amount < 0) {
      throw new Error(
        `rate card '${card.version}' (${card.lane}) line '${l.code}': amount ${l.amount} is not a whole non-negative EUR integer`,
      );
    }
  }

  const base: Record<string, number> = {};
  for (const l of lines) {
    if (l.kind === "base" && l.container_type) base[l.container_type] = l.amount;
  }
  const ordered = (kind: RateCardLineRow["kind"]) =>
    lines.filter((l) => l.kind === kind).sort((a, b) => a.sort_order - b.sort_order);

  return {
    mode: card.mode,
    version: card.version,
    validity_through: card.validity_through,
    supported_lane: card.lane,
    base_per_container: base as RateCard["base_per_container"],
    surcharges: ordered("surcharge_per_container").map((l) => ({
      code: l.code,
      amount_per_container: l.amount,
    })),
    per_shipment_fees: ordered("per_shipment_fee").map((l) => ({ code: l.code, amount: l.amount })),
  };
}
