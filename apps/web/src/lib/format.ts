/**
 * Shared display formatting — the single source of truth for money, timestamps, and escalation-reason
 * labels, so every view (inbox / quotations / archive) renders identical text for the same data.
 */

/** EUR amount with en-US thousands grouping, e.g. "EUR 3,520". */
export const eur = (n: number) => `EUR ${n.toLocaleString("en-US")}`;

/** Minor-unit exponents (ISO 4217) for the v2 currency allowlist — mirrors packages/core money.ts
 *  CURRENCIES locally (apps/web carries no cross-package runtime dependency). */
const EXPONENTS: Record<string, number> = {
  EUR: 2, USD: 2, GBP: 2, CNY: 2, SGD: 2, ZAR: 2, BRL: 2, HKD: 2, INR: 2, JPY: 0,
};

/**
 * A v2 wire amount (minor units as a decimal string) rendered exactly with its currency, e.g.
 * ("2110950", "USD") -> "USD 21,109.50", ("1234567", "JPY") -> "JPY 1,234,567". Pure string
 * arithmetic — never a float. Returns null for a malformed amount or a currency outside the allowlist.
 */
export function minorMoney(minor: string, currency: string): string | null {
  if (!Object.hasOwn(EXPONENTS, currency) || !/^\d+$/.test(minor)) return null;
  const exp = EXPONENTS[currency]!;
  const digits = minor.replace(/^0+(?=\d)/, "").padStart(exp + 1, "0");
  const int = digits.slice(0, digits.length - exp).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return exp === 0 ? `${currency} ${int}` : `${currency} ${int}.${digits.slice(-exp)}`;
}

/** ISO timestamp rendered in UTC with an explicit suffix, e.g. "01/06/2026, 16:00:01 UTC". */
export const utc = (iso: string) => `${new Date(iso).toLocaleString("en-GB", { timeZone: "UTC" })} UTC`;

/** Human-readable labels for every escalation reason code the agent can persist (mirrors
 *  packages/core reasons.ts ESCALATION_REASONS; a test asserts full coverage). */
export const REASON_LABELS: Record<string, string> = {
  missing_required_field: "Missing a required field",
  out_of_scope_lane: "Lane not in the rate card",
  out_of_scope_mode: "Transport mode not priced yet",
  out_of_scope_container: "Container type not priced on this lane",
  out_of_scope_service: "Service not priced yet",
  out_of_scope_cargo: "Cargo type not handled",
  conflicting_cargo: "Conflicting cargo details",
  request_too_large: "Request too large to process",
  rate_expired: "Rate card has expired",
  ambiguous_request: "Ambiguous request",
  tariff_config_error: "Tariff configuration error",
  pricing_capacity_exceeded: "Too many pricing combinations",
  fx_invalid: "Exchange rate data invalid",
  fx_missing_rate: "Exchange rate missing",
  model_refused: "Model declined the request",
  model_output_invalid: "Model output unusable",
  low_confidence: "Low extraction confidence",
  guard_violation: "Safety guard tripped — failed closed",
};

/** Label for an escalation reason; unknown codes fall back to the humanized code. */
export function reasonLabel(code: string): string {
  return REASON_LABELS[code] ?? code.replace(/_/g, " ");
}
