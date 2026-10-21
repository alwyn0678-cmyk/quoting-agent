import { Dec, roundDiv } from "./dec.js";
import { CURRENCIES, exponentOf, isCurrency, money, type Currency, type Money } from "./money.js";
import { dayNumber, isIsoDate } from "../time/dates.js";

/**
 * FX snapshots and exact conversion. A snapshot lists, for each currency, the units of that currency
 * per ONE unit of the base (ECB style: base EUR, USD 1.1234). A conversion is computed as one exact
 * rational and rounded ONCE (half away from zero) into the target's minor units — no intermediate
 * cross rate is ever rounded. Every non-identity conversion returns a typed receipt that is copied into
 * the quote, so the figure can be reproduced from the snapshot alone.
 */

export interface FxSnapshot {
  base: Currency;
  rates: Partial<Record<Currency, Dec>>;
  source: string;
  /** Publication date of the rates (YYYY-MM-DD). */
  as_of: string;
}

export interface FxReceipt {
  kind: "BUY" | "SELL";
  from: Currency;
  to: Currency;
  input_minor: string;
  output_minor: string;
  /** Snapshot rates used (units per 1 base): value_to = value_from × rate_to / rate_from. */
  rate_from: string;
  rate_to: string;
  base: Currency;
  source: string;
  as_of: string;
  rounding: "HALF_AWAY_FROM_ZERO";
}

export class FxMissingRateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FxMissingRateError";
  }
}

/** Maximum snapshot age in days before a conversion is refused (ASSUMPTIONS.md H5). */
export const FX_MAX_AGE_DAYS = 7;

export function validateFx(fx: FxSnapshot): string[] {
  const errors: string[] = [];
  if (!isCurrency(fx.base)) errors.push(`unsupported base currency '${String(fx.base)}'`);
  if (!isIsoDate(fx.as_of)) errors.push("as_of must be a real calendar date (YYYY-MM-DD)");
  if (!fx.source) errors.push("source is required");
  for (const [ccy, rate] of Object.entries(fx.rates)) {
    if (!isCurrency(ccy)) errors.push(`unsupported currency '${ccy}'`);
    else if (!rate || rate.cmp(Dec.ZERO) <= 0) errors.push(`rate for ${ccy} must be > 0`);
  }
  const baseRate = fx.rates[fx.base];
  if (!baseRate || baseRate.cmp(Dec.ONE) !== 0) errors.push("base rate must be exactly 1");
  return errors;
}

/** ok: 0 ≤ age ≤ FX_MAX_AGE_DAYS relative to `asOf`; future-dated snapshots are rejected too. */
export function fxFreshness(fx: FxSnapshot, asOf: string): "ok" | "stale" | "future" {
  const age = dayNumber(asOf) - dayNumber(fx.as_of);
  if (age < 0) return "future";
  if (age > FX_MAX_AGE_DAYS) return "stale";
  return "ok";
}

export function convert(
  m: Money,
  to: Currency,
  fx: FxSnapshot,
  kind: "BUY" | "SELL",
): { money: Money; receipt: FxReceipt | null } {
  if (m.currency === to) return { money: m, receipt: null };
  const rFrom = fx.rates[m.currency];
  const rTo = fx.rates[to];
  if (!rFrom || !rTo) {
    throw new FxMissingRateError(`fx_missing_rate: no ${!rFrom ? m.currency : to} rate in the ${fx.source} snapshot of ${fx.as_of}`);
  }
  const eFrom = exponentOf(m.currency);
  const eTo = exponentOf(to);
  // out_minor = in_minor · 10^-eFrom · (rTo / rFrom) · 10^eTo, with r = coef · 10^-scale:
  const numerator = m.minor * rTo.coef * 10n ** BigInt(eTo + rFrom.scale);
  const denominator = rFrom.coef * 10n ** BigInt(eFrom + rTo.scale);
  const out = money(roundDiv(numerator, denominator, "HALF_AWAY_FROM_ZERO"), to);
  return {
    money: out,
    receipt: {
      kind,
      from: m.currency,
      to,
      input_minor: m.minor.toString(),
      output_minor: out.minor.toString(),
      rate_from: rFrom.toString(),
      rate_to: rTo.toString(),
      base: fx.base,
      source: fx.source,
      as_of: fx.as_of,
      rounding: "HALF_AWAY_FROM_ZERO",
    },
  };
}

export { CURRENCIES };
