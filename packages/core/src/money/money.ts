import { Dec } from "./dec.js";

/**
 * Money is an integer count of the currency's minor unit (cents, öre …) — never a float, never a
 * major-unit number. The exponent is data (ISO 4217), not an assumed 2. The allowlist is small on
 * purpose: adding a currency is a deliberate, tested change.
 */
export const CURRENCIES = {
  EUR: { exponent: 2 },
  USD: { exponent: 2 },
  GBP: { exponent: 2 },
  CNY: { exponent: 2 },
  SGD: { exponent: 2 },
  ZAR: { exponent: 2 },
  BRL: { exponent: 2 },
  HKD: { exponent: 2 },
  INR: { exponent: 2 },
  JPY: { exponent: 0 },
} as const;

export type Currency = keyof typeof CURRENCIES;

/** Upper bound on amounts — far above any real quote, well inside Postgres bigint. Amounts are ≥ 0 in
 *  P1a (no rebates/credits); signed deltas are computed on raw bigints, never as Money. */
export const MAX_ABS_MINOR = 10n ** 15n;

export interface Money {
  readonly minor: bigint;
  readonly currency: Currency;
}

export function isCurrency(x: unknown): x is Currency {
  return typeof x === "string" && Object.prototype.hasOwnProperty.call(CURRENCIES, x);
}

export function exponentOf(currency: Currency): number {
  return CURRENCIES[currency].exponent;
}

export function money(minor: bigint, currency: Currency): Money {
  if (!isCurrency(currency)) throw new Error(`unsupported currency '${String(currency)}'`);
  if (minor < 0n) throw new Error(`negative amount not allowed: ${minor}`);
  if (minor > MAX_ABS_MINOR) throw new Error(`amount out of bound: ${minor}`);
  return { minor, currency };
}

/** Exact major-unit string → Money. More decimals than the currency allows is an error, never a round. */
export function fromMajor(major: string, currency: Currency): Money {
  const d = Dec.parse(major);
  let minor: bigint;
  try {
    minor = d.coefAt(exponentOf(currency));
  } catch {
    throw new Error(`precision: '${major}' has more decimal places than ${currency} allows`);
  }
  return money(minor, currency);
}

export function toDec(m: Money): Dec {
  return Dec.of(m.minor, exponentOf(m.currency));
}

export function toMajorString(m: Money): string {
  return toDec(m).toFixedString(exponentOf(m.currency));
}

function sameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new Error(`currency mismatch: ${a.currency} vs ${b.currency}`);
}

export function addMoney(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.minor + b.minor, a.currency);
}

export function subMoney(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.minor - b.minor, a.currency);
}

export function cmpMoney(a: Money, b: Money): -1 | 0 | 1 {
  sameCurrency(a, b);
  return a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0;
}

export function sumMoney(items: readonly Money[], currency: Currency): Money {
  return items.reduce((acc, m) => addMoney(acc, m), money(0n, currency));
}

/**
 * One charge line: rate × quantity, exact, then ONE rounding (half away from zero) to the currency's
 * minor unit. This is the only rounding point of a line's amount.
 */
export function chargeAmount(rate: Dec, qty: Dec, currency: Currency): Money {
  const exact = rate.mul(qty);
  return money(exact.round(exponentOf(currency), "HALF_AWAY_FROM_ZERO").coef, currency);
}
