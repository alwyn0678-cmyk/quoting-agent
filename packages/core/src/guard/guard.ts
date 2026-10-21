import { toWire } from "../pricing/wire.js";
import { price, type PriceInput, type PricingContext } from "../pricing/engine.js";
import type { PricingResult, RouteOption } from "../pricing/types.js";
import type { Tariff } from "../tariff/model.js";

/**
 * Guard v2 — deterministic, fail-closed checks:
 *  - price_mismatch: re-run the engine on the same inputs; the canonical wire JSON must be identical
 *    (candidates, presentation, ordering, totals, trace) — catches nondeterminism;
 *  - checkInvariants: properties any correct result satisfies (sums, FX, provenance, margins,
 *    validity) — catches an engine that is deterministic but wrong.
 *  - canary_leak: the system-prompt canary must not appear anywhere in the output.
 * There is no draft-prose check because there is no model prose: drafts are rendered entirely by
 * code from a closed set of model choices (draft/render.ts, spec §17.6).
 */

export type GuardViolation =
  | "price_mismatch"
  | "canary_leak"
  | "presented_not_candidate"
  | "too_many_presented"
  | "subtotal_mismatch"
  | "fx_total_mismatch"
  | "unknown_tariff_receipt"
  | "sell_below_buy"
  | "expired_validity";

export function guardPricing(input: PriceInput, tariffs: readonly Tariff[], ctx: PricingContext, result: PricingResult): GuardViolation[] {
  const again = price(input, tariffs, ctx);
  const same = JSON.stringify(toWire(again)) === JSON.stringify(toWire(result));
  return [...(same ? [] : (["price_mismatch"] as GuardViolation[])), ...checkInvariants(result, tariffs, ctx)];
}

/**
 * Independent invariants over a priced result (independent review #5): a re-derivation can only catch
 * nondeterminism, so these check properties that must hold whatever the engine computed —
 *  - presented ⊆ candidates, at most max_options;
 *  - each currency subtotal is the exact sum of that currency's sell lines (legs + adjustments);
 *  - the quote total is the quote-currency subtotal plus, per other currency, exactly one SELL FX
 *    receipt whose input is that subtotal (its output is what is added);
 *  - every line's receipt names a tariff in THIS snapshot with the same content hash (provenance);
 *  - no line is sold below its buy (all margin kinds are non-negative);
 *  - no option is valid before the as-of date.
 */
export function checkInvariants(result: PricingResult, tariffs: readonly Tariff[], ctx: Pick<PricingContext, "as_of" | "max_options">): GuardViolation[] {
  if (result.kind !== "priced") return [];
  const v = new Set<GuardViolation>();
  const ids = new Set(result.candidates.map((c) => c.id));
  if (result.presented.some((id) => !ids.has(id))) v.add("presented_not_candidate");
  if (result.presented.length > ctx.max_options) v.add("too_many_presented");
  const hashes = new Map(tariffs.map((t) => [t.id, t.content_hash]));
  for (const o of result.candidates) {
    checkOption(o, result.quote_currency, hashes, ctx.as_of, v);
  }
  return [...v];
}

function checkOption(o: RouteOption, quote: string, hashes: Map<string, string>, asOf: string, v: Set<GuardViolation>): void {
  const lines = [...o.legs.flatMap((l) => l.lines), ...o.adjustments];
  const sums = new Map<string, bigint>();
  for (const l of lines) {
    sums.set(l.sell.currency, (sums.get(l.sell.currency) ?? 0n) + l.sell.minor);
    if (l.buy && (l.buy.currency !== l.sell.currency || l.sell.minor < l.buy.minor)) v.add("sell_below_buy");
    if (l.receipt.rate_line_id !== null && hashes.get(l.receipt.tariff_id) !== l.receipt.content_hash) v.add("unknown_tariff_receipt");
  }
  const stated = new Map(o.totals.by_currency.map((m) => [m.currency as string, m.minor]));
  if (stated.size !== sums.size || [...sums].some(([c, m]) => stated.get(c) !== m)) v.add("subtotal_mismatch");
  let total = stated.get(quote) ?? 0n;
  for (const [c, m] of stated) {
    if (c === quote) continue;
    const r = o.fx_conversions.filter((x) => x.kind === "SELL" && x.from === c && x.to === quote);
    if (r.length !== 1 || BigInt(r[0]!.input_minor) !== m) {
      v.add("fx_total_mismatch");
      continue;
    }
    total += BigInt(r[0]!.output_minor);
  }
  if (o.totals.quote.currency !== quote || o.totals.quote.minor !== total) v.add("fx_total_mismatch");
  if (o.valid_until < asOf) v.add("expired_validity");
}

export function containsCanary(output: unknown, canary: string): boolean {
  return JSON.stringify(toWire(output)).includes(canary);
}
