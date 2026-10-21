import { toWire } from "../pricing/wire.js";
import { price, type PriceInput, type PricingContext } from "../pricing/engine.js";
import type { PricingResult } from "../pricing/types.js";
import type { Tariff } from "../tariff/model.js";

/**
 * Guard v2 — deterministic, fail-closed checks:
 *  - price_mismatch: re-run the engine on the same inputs; the canonical wire JSON must be identical
 *    (candidates, presentation, ordering, totals, trace).
 *  - canary_leak: the system-prompt canary must not appear anywhere in the output.
 * There is no draft-prose check because there is no model prose: drafts are rendered entirely by
 * code from a closed set of model choices (draft/render.ts, spec §17.6).
 */

export type GuardViolation = "price_mismatch" | "canary_leak";

export function guardPricing(input: PriceInput, tariffs: readonly Tariff[], ctx: PricingContext, result: PricingResult): GuardViolation[] {
  const again = price(input, tariffs, ctx);
  return JSON.stringify(toWire(again)) === JSON.stringify(toWire(result)) ? [] : ["price_mismatch"];
}

export function containsCanary(output: unknown, canary: string): boolean {
  return JSON.stringify(toWire(output)).includes(canary);
}
