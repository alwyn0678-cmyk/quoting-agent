import { createHash } from "node:crypto";
import { Dec } from "../money/dec.js";
import { AmountBoundError, chargeAmount, exponentOf, fromMajor, money, toDec, type Currency, type Money } from "../money/money.js";
import { convert, fxFreshness, FxMissingRateError, validateFx, type FxReceipt, type FxSnapshot } from "../money/fx.js";
import { teuOf, type IsoType } from "../places/equipment.js";
import type { NormalizedCargo } from "../request/normalize.js";
import { addDays, dayNumber, maxDate, minDate } from "../time/dates.js";
import { SHIPMENT_LEVEL, type ChargeDef, type Tariff, type TariffMode } from "../tariff/model.js";
import { toWire } from "./wire.js";
import { matchOffers, type MatchedLine, type Offer } from "../tariff/matcher.js";
import { modeModule, type Quantities } from "../modes/modes.js";
import { appliesTo, lineSell, selectMarginRule, type MarginRule } from "../margin/margin.js";
import type { ChargeLine, PricingResult, PricingTrace, RouteOption, UnpriceableReason } from "./types.js";

/**
 * The pricing engine: request + tariff snapshot + context → every priceable option with line-level
 * receipts, or a named reason why not. Pure and deterministic: same inputs ⇒ byte-identical wire
 * output (the guard depends on this). Sequence per offer (spec §1, §5, §16):
 *   quantities → charges (one rounding each, then min/max clamp) → shipment-level charges once (must be
 *   identical across composed lines) → margin (per line, on own buy) → per-currency subtotals →
 *   FX once per subtotal → minimum margin (separate MARGIN_ADJ line) → validity, transit → ordering.
 */

export interface PricingContext {
  as_of: string;
  quote_currency: Currency;
  max_options: number;
  quote_validity_days: number;
  fx: FxSnapshot | null;
  margin_rules: readonly MarginRule[];
}

export interface PriceInput {
  mode: TariffMode;
  origin: string;
  destination: string;
  cargo: NormalizedCargo;
  ready_date: string | null;
}

class Unpriceable extends Error {
  constructor(
    readonly reason: UnpriceableReason,
    detail: string,
  ) {
    super(detail);
  }
}

class OfferRejected extends Error {}

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function qtyFor(basis: ChargeDef["basis"], equipment: IsoType | null, q: Quantities): Dec {
  switch (basis) {
    case "PER_CONTAINER":
      return Dec.fromInt(equipment ? (q.containers[equipment] ?? 0) : 0);
    case "PER_TEU":
      return Dec.fromInt(equipment ? (q.containers[equipment] ?? 0) * teuOf(equipment) : 0);
    case "PER_SHIPMENT":
    case "PER_BL":
      return Dec.ONE;
    case "PER_WM":
      return q.revenue_tons ?? Dec.ZERO;
    case "PER_CBM":
      return q.volume_cbm ?? Dec.ZERO;
    case "PER_TON":
      return q.weight_tonnes ?? Dec.ZERO;
    case "PCT_OF":
      throw new Error("internal: PCT_OF quantity is its base amount");
  }
}

function clamp(amount: Money, ch: ChargeDef): { amount: Money; clamped: "min" | "max" | null } {
  if (ch.min && amount.minor < ch.min.minor) return { amount: ch.min, clamped: "min" };
  if (ch.max && amount.minor > ch.max.minor) return { amount: ch.max, clamped: "max" };
  return { amount, clamped: null };
}

interface RawLine {
  ml: MatchedLine;
  ch: ChargeDef;
  equipment: IsoType | null;
  qty: Dec;
  amount: Money;
  clamped: "min" | "max" | null;
}

/** Evaluate every charge of an offer (before margin). */
function evaluateOffer(offer: Offer, q: Quantities): RawLine[] {
  const out: RawLine[] = [];
  for (const ml of offer.lines) {
    const amounts = new Map<string, Money>();
    for (const ch of ml.line.charges) {
      if (SHIPMENT_LEVEL.has(ch.basis)) continue;
      let qty: Dec;
      let exact: Money;
      if (ch.basis === "PCT_OF") {
        const base = ch.percent_of.reduce((acc, id) => acc + (amounts.get(id)?.minor ?? 0n), 0n);
        qty = Dec.of(base, exponentOf(ch.currency));
        exact = chargeAmount(ch.rate, qty, ch.currency);
      } else {
        qty = qtyFor(ch.basis, ml.equipment, q);
        exact = chargeAmount(ch.rate, qty, ch.currency);
      }
      const c = clamp(exact, ch);
      amounts.set(ch.id, c.amount);
      out.push({ ml, ch, equipment: ml.equipment, qty, amount: c.amount, clamped: c.clamped });
    }
  }
  // Shipment-level charges: once per offer, and only if every composed line defines them identically.
  const sets = offer.lines.map((ml) =>
    ml.line.charges.filter((c) => SHIPMENT_LEVEL.has(c.basis)).map((c) => c.canonical).sort().join("\u0000"),
  );
  if (sets.some((s) => s !== sets[0])) throw new OfferRejected("inconsistent_offer");
  const first = offer.lines[0]!;
  for (const ch of first.line.charges) {
    if (!SHIPMENT_LEVEL.has(ch.basis)) continue;
    const c = clamp(chargeAmount(ch.rate, Dec.ONE, ch.currency), ch);
    out.push({ ml: first, ch, equipment: null, qty: Dec.ONE, amount: c.amount, clamped: c.clamped });
  }
  return out;
}

function receiptFor(t: Tariff, rl: RawLine | null, chargeId: string, marginRuleId: string | null) {
  return {
    tariff_id: t.id,
    tariff_version: t.version,
    content_hash: t.content_hash,
    rate_line_id: rl ? rl.ml.line.id : null,
    charge_id: chargeId,
    source_ref: rl ? rl.ml.line.source_ref : null,
    margin_rule_id: marginRuleId,
    rounding: "HALF_AWAY_FROM_ZERO" as const,
  };
}

function subtotals(lines: readonly ChargeLine[], pick: (l: ChargeLine) => Money | null): Map<Currency, bigint> {
  const m = new Map<Currency, bigint>();
  for (const l of lines) {
    const v = pick(l);
    if (v) m.set(v.currency, (m.get(v.currency) ?? 0n) + v.minor);
  }
  return new Map([...m.entries()].sort(([a], [b]) => cmpStr(a, b)));
}

export function price(input: PriceInput, tariffs: readonly Tariff[], ctx: PricingContext): PricingResult {
  const pricing_date = maxDate(ctx.as_of, input.ready_date ?? ctx.as_of);
  const trace: PricingTrace = {
    as_of: ctx.as_of,
    pricing_date,
    considered: 0,
    excluded: [],
    margin_rule_ids: [],
    fx_age_days: null,
  };
  const fail = (reason: UnpriceableReason, detail: string): PricingResult => ({ kind: "unpriceable", reason, detail, trace });

  const mod = modeModule(input.mode);
  if (!mod) return fail("out_of_scope_mode", `no pricing module for ${input.mode}`);
  const missing = mod.missingFields(input.cargo);
  if (missing.length > 0) return fail("missing_required_field", missing.join(","));
  const quantities = mod.quantities(input.cargo);
  const equipment = (Object.keys(quantities.containers) as IsoType[]).sort(cmpStr);

  const match = matchOffers(tariffs, {
    mode: input.mode,
    origin: input.origin,
    destination: input.destination,
    equipment,
    as_of: ctx.as_of,
    pricing_date,
  });
  trace.considered = match.trace.considered;
  trace.excluded = [...match.trace.excluded];
  if (match.kind === "none") return fail(match.reason, `no usable rate for ${input.origin}→${input.destination}`);
  if (match.kind === "ambiguous") return fail("ambiguous_request", match.groups.map((g) => `${g.key}: ${g.line_ids.join("|")}`).join("; "));
  if (match.kind === "capacity") return fail("pricing_capacity_exceeded", "too many candidate offers");

  // FX is validated lazily: only when some option actually needs a conversion.
  let fxChecked = false;
  const fxOrFail = (): FxSnapshot => {
    if (!ctx.fx) throw new Unpriceable("fx_missing_rate", "a currency conversion is needed but no FX snapshot is configured");
    if (!fxChecked) {
      const errors = validateFx(ctx.fx);
      if (errors.length > 0) throw new Unpriceable("fx_invalid", errors.join("; "));
      const fresh = fxFreshness(ctx.fx, ctx.as_of);
      if (fresh !== "ok") throw new Unpriceable("fx_invalid", `FX snapshot of ${ctx.fx.as_of} is ${fresh} relative to ${ctx.as_of}`);
      trace.fx_age_days = dayNumber(ctx.as_of) - dayNumber(ctx.fx.as_of);
      fxChecked = true;
    }
    return ctx.fx;
  };
  const convertSubtotal = (minor: bigint, from: Currency, kind: "BUY" | "SELL", receipts: FxReceipt[]): bigint => {
    if (from === ctx.quote_currency) return minor;
    try {
      const r = convert(money(minor, from), ctx.quote_currency, fxOrFail(), kind);
      if (r.receipt) receipts.push(r.receipt);
      return r.money.minor;
    } catch (e) {
      // Only a genuinely absent rate is fx_missing_rate; bound overflows surface as AmountBoundError.
      if (e instanceof FxMissingRateError) throw new Unpriceable("fx_missing_rate", e.message);
      throw e;
    }
  };
  const sumConverted = (lines: readonly ChargeLine[], pick: (l: ChargeLine) => Money | null, kind: "BUY" | "SELL", receipts: FxReceipt[]) =>
    [...subtotals(lines, pick)].reduce((acc, [ccy, minor]) => acc + convertSubtotal(minor, ccy, kind, receipts), 0n);

  const candidates: RouteOption[] = [];
  const marginRuleIds = new Set<string>();
  try {
    for (const offer of match.offers) {
      try {
      let raw: RawLine[];
      try {
        raw = evaluateOffer(offer, quantities);
      } catch (e) {
        if (e instanceof OfferRejected) {
          trace.excluded.push({ key: offer.key, reason: e.message });
          continue;
        }
        throw e;
      }
      const priceKind = offer.lines[0]!.line.price_kind;
      let rule: MarginRule | null = null;
      if (priceKind === "BUY") {
        const sel = selectMarginRule(ctx.margin_rules, {
          mode: input.mode,
          origin: input.origin,
          destination: input.destination,
          groups: offer.tariff.port_groups,
        });
        if (sel.kind === "none") {
          trace.excluded.push({ key: offer.key, reason: "no_margin_rule" });
          continue;
        }
        if (sel.kind !== "rule") {
          trace.excluded.push({ key: offer.key, reason: sel.kind === "ambiguous" ? `ambiguous_margin_rule:${sel.rule_ids.join("|")}` : "invalid_margin_rule" });
          continue;
        }
        rule = sel.rule;
        marginRuleIds.add(rule.id);
        trace.margin_rule_ids = [...marginRuleIds].sort(cmpStr);
      }

      const lines: ChargeLine[] = raw.map((r) => {
        const applied = rule !== null && rule.kind !== "FLAT" && appliesTo(rule, r.ch.category);
        return {
          id: `${r.ml.line.id}:${r.ch.id}`,
          code: r.ch.code,
          description: r.ch.description,
          category: r.ch.category,
          basis: r.ch.basis,
          equipment: r.equipment,
          qty: r.qty,
          rate: r.ch.rate,
          buy: priceKind === "BUY" ? r.amount : null,
          sell: rule ? lineSell(r.amount, r.ch.category, rule) : r.amount,
          clamped: r.clamped,
          receipt: receiptFor(offer.tariff, r, r.ch.id, applied ? rule!.id : null),
        };
      });

      const adjustments: ChargeLine[] = [];
      const marginLine = (code: "MARGIN_FLAT" | "MARGIN_ADJ", description: string, sell: Money): ChargeLine => ({
        id: `${offer.key}:${code}`,
        code,
        description,
        category: "MARGIN",
        basis: "MARGIN",
        equipment: null,
        qty: Dec.ONE,
        rate: toDec(sell),
        buy: null,
        sell,
        clamped: null,
        receipt: receiptFor(offer.tariff, null, code, rule ? rule.id : null),
      });
      if (rule && rule.kind === "FLAT" && rule.currency) {
        adjustments.push(marginLine("MARGIN_FLAT", "Service fee", fromMajor(rule.value.toString(), rule.currency)));
      }

      const fx_conversions: FxReceipt[] = [];
      const all = () => [...lines, ...adjustments];
      // Charge lines and FLAT are converted separately so the minimum margin can be measured on the
      // BUY-derived lines only (spec §16.2) — a FLAT fee never counts towards it.
      const linesSellQuote = sumConverted(lines, (l) => l.sell, "SELL", fx_conversions);
      let quoteMinor = linesSellQuote + sumConverted(adjustments, (l) => l.sell, "SELL", fx_conversions);

      if (rule?.min_margin) {
        if (rule.min_margin.currency !== ctx.quote_currency) {
          trace.excluded.push({ key: offer.key, reason: "min_margin_currency_mismatch" });
          continue;
        }
        const buyQuote = sumConverted(lines, (l) => l.buy, "BUY", fx_conversions);
        const shortfall = rule.min_margin.minor - (linesSellQuote - buyQuote);
        if (shortfall > 0n) {
          adjustments.push(marginLine("MARGIN_ADJ", "Minimum service charge", money(shortfall, ctx.quote_currency)));
          quoteMinor += shortfall;
        }
      }

      const by_currency = [...subtotals(all(), (l) => l.sell).entries()].map(([ccy, minor]) => money(minor, ccy));
      const ends = offer.lines.flatMap((ml) => [ml.line.valid_to, ml.tariff.valid_to]);
      const valid_until = ends.reduce(minDate, addDays(ctx.as_of, ctx.quote_validity_days));
      const transits = offer.lines.map((ml) => ml.line.transit_days);
      const transit_days = transits.every((t) => t !== null) ? Math.max(...(transits as number[])) : null;
      const option: Omit<RouteOption, "id"> = {
        offer_key: offer.key,
        carrier: offer.carrier,
        tariff_id: offer.tariff.id,
        price_kind: priceKind,
        legs: [{ mode: input.mode, origin: input.origin, destination: input.destination, quantities, lines }],
        adjustments,
        totals: { by_currency, quote: money(quoteMinor, ctx.quote_currency) },
        fx_conversions,
        transit_days,
        valid_until,
      };
      // The id hashes the whole commercial option (tariff hash, quantities, lines, totals, FX, validity).
      const id = createHash("sha256").update(JSON.stringify(toWire({ tariff_hash: offer.tariff.content_hash, option }))).digest("hex");
      candidates.push({ id, ...option });
      } catch (e) {
        if (e instanceof AmountBoundError) {
          trace.excluded.push({ key: offer.key, reason: "amount_out_of_bound" });
          continue;
        }
        if (e instanceof Unpriceable) trace.excluded.push({ key: offer.key, reason: e.reason });
        throw e;
      }
    }
  } catch (e) {
    if (e instanceof Unpriceable) return fail(e.reason, e.message);
    throw e;
  }

  trace.margin_rule_ids = [...marginRuleIds].sort(cmpStr);
  const offerFailures = trace.excluded.filter((x) => match.offers.some((o) => o.key === x.key));
  if (candidates.length === 0 && offerFailures.length > 0 && offerFailures.every((x) => x.reason === "amount_out_of_bound")) {
    return fail("pricing_capacity_exceeded", "an amount exceeds the supported maximum");
  }
  if (candidates.length === 0) {
    return fail("tariff_config_error", `rates matched but every offer was invalid: ${trace.excluded.map((x) => `${x.key}=${x.reason}`).join(", ")}`);
  }
  candidates.sort(
    (a, b) =>
      (a.totals.quote.minor < b.totals.quote.minor ? -1 : a.totals.quote.minor > b.totals.quote.minor ? 1 : 0) ||
      cmpStr(a.carrier, b.carrier) ||
      cmpStr(a.id, b.id),
  );
  return {
    kind: "priced",
    quote_currency: ctx.quote_currency,
    candidates,
    presented: candidates.slice(0, Math.max(1, ctx.max_options)).map((c) => c.id),
    trace,
  };
}
