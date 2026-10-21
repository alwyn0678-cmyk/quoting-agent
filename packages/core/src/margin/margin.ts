import { Dec } from "../money/dec.js";
import { exponentOf, fromMajor, money, toDec, type Currency, type Money } from "../money/money.js";
import { laneEndScore, type LaneEnd, type PortGroups } from "../places/places.js";
import type { ChargeCategory, TariffMode } from "../tariff/model.js";

/**
 * Margin rules turn BUY rates into SELL prices. Formulas (spec §16.2), each with ONE rounding (half
 * away from zero) to the line currency's minor unit, computed on the line's own buy — never on a
 * running total, so rules cannot compound:
 *   MARKUP_ON_BUY  sell = buy × (1 + m)          m ∈ [0, 10]
 *   GROSS_MARGIN   sell = buy / (1 − m)          m ∈ [0, 0.95]   (m is the margin share of the sell)
 *   FLAT           one shipment-level MARGIN_FLAT line of `value` in `currency`; lines sell at buy
 * A minimum margin (quote currency) is enforced by the engine after FX, as a separate line.
 * Selection uses the same dominance partial order as tariffs; an unresolved tie is a configuration
 * error, never a silent pick.
 */

export interface MarginRule {
  id: string;
  match: { mode?: TariffMode; origin?: LaneEnd; destination?: LaneEnd };
  kind: "MARKUP_ON_BUY" | "GROSS_MARGIN" | "FLAT";
  value: Dec;
  /** Required for FLAT. */
  currency?: Currency;
  min_margin?: Money;
  applies_to: ChargeCategory[] | "ALL";
  priority: number;
}

export function validateMarginRule(r: MarginRule): string[] {
  const errors: string[] = [];
  const within = (lo: string, hi: string) => r.value.cmp(Dec.parse(lo)) >= 0 && r.value.cmp(Dec.parse(hi)) <= 0;
  if (r.kind === "MARKUP_ON_BUY" && !within("0", "10")) errors.push(`margin rule '${r.id}': MARKUP_ON_BUY must be in [0, 10]`);
  if (r.kind === "GROSS_MARGIN" && !within("0", "0.95")) errors.push(`margin rule '${r.id}': GROSS_MARGIN must be in [0, 0.95]`);
  if (r.kind === "FLAT") {
    if (!r.currency) errors.push(`margin rule '${r.id}': FLAT needs a currency`);
    else {
      try {
        fromMajor(r.value.toString(), r.currency);
      } catch {
        errors.push(`margin rule '${r.id}': FLAT value not representable in ${r.currency}`);
      }
    }
  }
  return errors;
}

type Scored = { rule: MarginRule; s: [number, number, number] };

export type MarginSelection =
  | { kind: "rule"; rule: MarginRule }
  | { kind: "none" }
  | { kind: "ambiguous"; rule_ids: string[] }
  | { kind: "invalid"; errors: string[] };

export function selectMarginRule(
  rules: readonly MarginRule[],
  q: { mode: TariffMode; origin: string; destination: string; groups: PortGroups },
): MarginSelection {
  const errors = rules.flatMap(validateMarginRule);
  if (errors.length > 0) return { kind: "invalid", errors };
  const scored: Scored[] = [];
  for (const rule of rules) {
    if (rule.match.mode && rule.match.mode !== q.mode) continue;
    const o = rule.match.origin ? laneEndScore(rule.match.origin, q.origin, q.groups) : 0;
    const d = rule.match.destination ? laneEndScore(rule.match.destination, q.destination, q.groups) : 0;
    if (o === null || d === null) continue;
    scored.push({ rule, s: [rule.match.mode ? 1 : 0, o, d] });
  }
  if (scored.length === 0) return { kind: "none" };
  const dominates = (a: Scored, b: Scored) =>
    a.s.every((v, i) => v >= b.s[i]!) && a.s.some((v, i) => v > b.s[i]!);
  const front = scored.filter((c) => !scored.some((o) => o !== c && dominates(o, c)));
  const top = Math.max(...front.map((c) => c.rule.priority));
  const winners = front.filter((c) => c.rule.priority === top);
  if (winners.length !== 1) return { kind: "ambiguous", rule_ids: winners.map((w) => w.rule.id).sort() };
  return { kind: "rule", rule: winners[0]!.rule };
}

export function appliesTo(rule: MarginRule, category: ChargeCategory): boolean {
  return rule.applies_to === "ALL" || rule.applies_to.includes(category);
}

/** Sell for one BUY line under `rule` (identity when the rule does not apply to the category or is FLAT). */
export function lineSell(buy: Money, category: ChargeCategory, rule: MarginRule): Money {
  if (rule.kind === "FLAT" || !appliesTo(rule, category)) return buy;
  const exp = exponentOf(buy.currency);
  const b = toDec(buy);
  const sell =
    rule.kind === "MARKUP_ON_BUY"
      ? b.mul(Dec.ONE.add(rule.value)).round(exp, "HALF_AWAY_FROM_ZERO")
      : Dec.divRound(b, Dec.ONE.sub(rule.value), exp, "HALF_AWAY_FROM_ZERO");
  return money(sell.coefAt(exp), buy.currency);
}
