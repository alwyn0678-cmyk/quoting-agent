import { laneEndScore } from "../places/places.js";
import type { IsoType } from "../places/equipment.js";
import type { RateLine, Tariff, TariffMode } from "./model.js";

/**
 * Tariff matching. Deterministic, explainable, and never silently picks between equals:
 *  1. Candidates: same mode, both lane ends match, FCL equipment requested, valid (inclusive) on BOTH
 *     the as-of date and the pricing date.
 *  2. Per (tariff, carrier, offer, equipment) group: keep the non-dominated set under the specificity
 *     partial order (A dominates B iff A ≥ B on origin AND destination score and > on one), then the
 *     highest priority. One line left ⇒ resolved; more ⇒ AMBIGUOUS (escalate — fix the data).
 *  3. Offers: an FCL offer exists only if every requested equipment type resolved within it.
 * Different carriers/offers are alternative options, never ambiguity.
 */

export const MAX_OFFERS = 200;

export interface MatchQuery {
  mode: TariffMode;
  origin: string;
  destination: string;
  /** Distinct requested ISO types (FCL); empty for LCL. */
  equipment: IsoType[];
  as_of: string;
  pricing_date: string;
}

export interface MatchedLine {
  tariff: Tariff;
  line: RateLine;
  equipment: IsoType | null;
  score: { origin: number; destination: number };
}

export interface Offer {
  key: string;
  tariff: Tariff;
  carrier: string;
  offer_id: string;
  /** One resolved line per requested equipment type (FCL, in canonical code order) or one (LCL). */
  lines: MatchedLine[];
}

export interface MatchTrace {
  considered: number;
  excluded: { key: string; reason: string }[];
}

export type MatchResult =
  | { kind: "matched"; offers: Offer[]; trace: MatchTrace }
  | { kind: "ambiguous"; groups: { key: string; line_ids: string[] }[]; trace: MatchTrace }
  | { kind: "none"; reason: "out_of_scope_lane" | "out_of_scope_container" | "rate_expired"; trace: MatchTrace }
  | { kind: "capacity"; trace: MatchTrace };

const validOn = (line: RateLine, day: string) => line.valid_from <= day && day <= line.valid_to;
const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function dominates(a: MatchedLine, b: MatchedLine): boolean {
  return (
    a.score.origin >= b.score.origin &&
    a.score.destination >= b.score.destination &&
    (a.score.origin > b.score.origin || a.score.destination > b.score.destination)
  );
}

export function matchOffers(tariffs: readonly Tariff[], q: MatchQuery): MatchResult {
  const trace: MatchTrace = { considered: 0, excluded: [] };
  const requested = new Set(q.equipment);
  let laneMatched = 0;
  /** Per requested equipment ("*" for LCL): lane-matched lines seen, and how many were valid. */
  const perEquipment = new Map<string, { seen: number; valid: number }>();
  const groups = new Map<string, MatchedLine[]>();

  for (const tariff of tariffs) {
    for (const line of tariff.lines) {
      if (line.mode !== q.mode) continue;
      const o = laneEndScore(line.origin, q.origin, tariff.port_groups);
      const d = laneEndScore(line.destination, q.destination, tariff.port_groups);
      if (o === null || d === null) continue;
      laneMatched += 1;
      if (q.mode === "FCL" && (!line.equipment || !requested.has(line.equipment))) continue;
      const eqKey = line.equipment ?? "*";
      const stats = perEquipment.get(eqKey) ?? { seen: 0, valid: 0 };
      stats.seen += 1;
      perEquipment.set(eqKey, stats);
      trace.considered += 1;
      if (!validOn(line, q.as_of) || !validOn(line, q.pricing_date)) {
        const reason = line.valid_from > q.as_of || line.valid_from > q.pricing_date ? "not_yet_valid" : "expired";
        trace.excluded.push({ key: line.id, reason });
        continue;
      }
      stats.valid += 1;
      const key = `${tariff.id}/${line.carrier}/${line.offer_id}/${line.equipment ?? "*"}`;
      const list = groups.get(key) ?? [];
      list.push({ tariff, line, equipment: line.equipment, score: { origin: o, destination: d } });
      groups.set(key, list);
    }
  }

  // Resolve each group: non-dominated set → highest priority → exactly one, or ambiguous.
  const resolved = new Map<string, MatchedLine>();
  const ambiguous: { key: string; line_ids: string[] }[] = [];
  for (const [key, candidates] of [...groups.entries()].sort(([a], [b]) => cmpStr(a, b))) {
    const front = candidates.filter((c) => !candidates.some((o) => o !== c && dominates(o, c)));
    const top = Math.max(...front.map((c) => c.line.priority));
    const winners = front.filter((c) => c.line.priority === top);
    if (winners.length === 1) resolved.set(key, winners[0]!);
    else ambiguous.push({ key, line_ids: winners.map((w) => w.line.id).sort(cmpStr) });
  }
  if (ambiguous.length > 0) return { kind: "ambiguous", groups: ambiguous, trace };

  // Assemble offers.
  const byOffer = new Map<string, MatchedLine[]>();
  for (const m of resolved.values()) {
    const key = `${m.tariff.id}/${m.line.carrier}/${m.line.offer_id}`;
    byOffer.set(key, [...(byOffer.get(key) ?? []), m]);
  }
  const offers: Offer[] = [];
  for (const [key, lines] of [...byOffer.entries()].sort(([a], [b]) => cmpStr(a, b))) {
    if (q.mode === "FCL") {
      const have = new Set(lines.map((l) => l.equipment));
      if (![...requested].every((e) => have.has(e))) {
        trace.excluded.push({ key, reason: "incomplete_equipment" });
        continue;
      }
    }
    const first = lines[0]!;
    offers.push({
      key,
      tariff: first.tariff,
      carrier: first.line.carrier,
      offer_id: first.line.offer_id,
      lines: [...lines].sort((a, b) => cmpStr(a.equipment ?? "", b.equipment ?? "")),
    });
  }

  if (offers.length > MAX_OFFERS) return { kind: "capacity", trace };
  if (offers.length > 0) return { kind: "matched", offers, trace };
  if (laneMatched === 0) return { kind: "none", reason: "out_of_scope_lane", trace };
  const wanted = q.mode === "FCL" ? [...requested] : ["*"];
  // A requested type nobody prices on this lane → container scope; priced only by expired lines → expired.
  if (wanted.some((e) => !perEquipment.has(e))) return { kind: "none", reason: "out_of_scope_container", trace };
  if (wanted.some((e) => perEquipment.get(e)!.valid === 0)) return { kind: "none", reason: "rate_expired", trace };
  // Every type has valid rates, but no single offer covers them all.
  return { kind: "none", reason: "out_of_scope_container", trace };
}
