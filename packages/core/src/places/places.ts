/**
 * Places and lane ends. A tariff lane end is a UN/LOCODE, a named port group, a country, or "any";
 * matching returns a specificity score (exact 3 > group 2 > country 1 > any 0) or null for no match.
 * Port groups are data carried in the tariff snapshot — never hard-coded here.
 */

const UNLOCODE_RE = /^[A-Z]{2}[A-Z2-9]{3}$/;
const IATA_RE = /^[A-Z]{3}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;

export const isUnlocode = (s: unknown): s is string => typeof s === "string" && UNLOCODE_RE.test(s);
export const isIata = (s: unknown): s is string => typeof s === "string" && IATA_RE.test(s);
export const isCountry = (s: unknown): s is string => typeof s === "string" && COUNTRY_RE.test(s);

export function countryOf(unlocode: string): string {
  if (!isUnlocode(unlocode)) throw new Error(`not a UN/LOCODE: '${unlocode}'`);
  return unlocode.slice(0, 2);
}

export type LaneEnd = { unlocode: string } | { group: string } | { country: string } | { any: true };

export type PortGroups = Readonly<Record<string, readonly string[]>>;

export function laneEndScore(end: LaneEnd, unlocode: string, groups: PortGroups): 3 | 2 | 1 | 0 | null {
  if ("unlocode" in end) return end.unlocode === unlocode ? 3 : null;
  if ("group" in end) return groups[end.group]?.includes(unlocode) ? 2 : null;
  if ("country" in end) return isUnlocode(unlocode) && countryOf(unlocode) === end.country ? 1 : null;
  return 0;
}

export function laneEndMatches(end: LaneEnd, unlocode: string, groups: PortGroups): boolean {
  return laneEndScore(end, unlocode, groups) !== null;
}
