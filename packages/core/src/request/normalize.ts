import { Dec } from "../money/dec.js";
import { normalizeEquipment, type IsoType } from "../places/equipment.js";
import type { Cargo } from "./schema.js";

/**
 * Cargo normalisation: every unit conversion and every total happens here, in exact decimals, with
 * exact definitional constants (1 lb = 0.45359237 kg; 1 in = 2.54 cm; 1 ft = 30.48 cm). Totals are
 * DERIVED from pieces; a stated total that disagrees beyond CONFLICT_TOLERANCE is reported as a
 * conflict for the gate to escalate — the engine never silently picks one of two contradicting facts.
 */

/** Canonical scales for normalised totals (spec §1): weight kg 3 dp, volume m³ 6 dp. */
export const WEIGHT_SCALE = 3;
export const VOLUME_SCALE = 6;
const canon = (d: Dec | null, scale: number): Dec | null => (d === null ? null : d.round(scale, "HALF_AWAY_FROM_ZERO").trimmed());

/** Physical plausibility bounds on effective totals (1,000,000 t; 10,000,000 m³): beyond them the
 *  request is rejected as request_too_large before any pricing arithmetic. */
export const MAX_TOTAL_WEIGHT_KG = Dec.parse("1000000000");
export const MAX_TOTAL_VOLUME_CBM = Dec.parse("10000000");

/** Relative difference above which stated and derived totals conflict (ASSUMPTIONS.md H3). */
export const CONFLICT_TOLERANCE = Dec.parse("0.02");

const KG_PER: Record<"kg" | "lb" | "t", Dec> = { kg: Dec.ONE, lb: Dec.parse("0.45359237"), t: Dec.parse("1000") };
const CM_PER: Record<"mm" | "cm" | "m" | "in" | "ft", Dec> = {
  mm: Dec.parse("0.1"), cm: Dec.ONE, m: Dec.parse("100"), in: Dec.parse("2.54"), ft: Dec.parse("30.48"),
};
const CBM_PER: Record<"cbm" | "cft", Dec> = { cbm: Dec.ONE, cft: Dec.parse("0.028316846592") };
const CM3_PER_CBM = Dec.parse("1000000");

const toKg = (w: { value: string; unit: keyof typeof KG_PER }) => Dec.parse(w.value).mul(KG_PER[w.unit]);
const toCm = (l: { value: string; unit: keyof typeof CM_PER }) => Dec.parse(l.value).mul(CM_PER[l.unit]);
const toCbm = (v: { value: string; unit: keyof typeof CBM_PER }) => Dec.parse(v.value).mul(CBM_PER[v.unit]);

export interface NormalizedPiece {
  qty: number;
  length_cm: Dec;
  width_cm: Dec;
  height_cm: Dec;
  weight_kg_each: Dec | null;
  stackable: boolean | null;
}

export interface NormalizedCargo {
  containers: { raw: string; iso: IsoType | null; qty: number }[];
  pieces: NormalizedPiece[];
  /** Effective totals: derived from pieces when available, else stated; null when unknown. */
  weight_kg: Dec | null;
  volume_cbm: Dec | null;
  conflicts: ("weight" | "volume")[];
  /** Effective totals beyond the plausibility bounds (gate: request_too_large). */
  oversize: ("weight" | "volume")[];
}

function differsBeyondTolerance(derived: Dec, stated: Dec): boolean {
  const diff = derived.sub(stated);
  const absDiff = diff.isNegative() ? diff.neg() : diff;
  // |derived − stated| > tolerance × stated  (stated > 0 by schema)
  return absDiff.cmp(CONFLICT_TOLERANCE.mul(stated)) > 0;
}

export function normalizeCargo(cargo: Cargo): NormalizedCargo {
  const pieces: NormalizedPiece[] = cargo.pieces.map((p) => ({
    qty: p.qty,
    length_cm: toCm(p.length),
    width_cm: toCm(p.width),
    height_cm: toCm(p.height),
    weight_kg_each: p.weight_each ? toKg(p.weight_each) : null,
    stackable: p.stackable,
  }));

  let derivedWeight: Dec | null = null;
  let derivedVolume: Dec | null = null;
  if (pieces.length > 0) {
    derivedVolume = pieces.reduce(
      (acc, p) => acc.add(p.length_cm.mul(p.width_cm).mul(p.height_cm).mul(Dec.fromInt(p.qty))),
      Dec.ZERO,
    );
    derivedVolume = Dec.divRound(derivedVolume, CM3_PER_CBM, derivedVolume.scale + 6, "HALF_AWAY_FROM_ZERO");
    derivedVolume = derivedVolume.trimmed(); // canonical (exact: division by 10^6)
    derivedWeight = pieces.every((p) => p.weight_kg_each !== null)
      ? pieces.reduce((acc, p) => acc.add(p.weight_kg_each!.mul(Dec.fromInt(p.qty))), Dec.ZERO)
      : null;
  }

  // Aggregate exactly, then round once to the canonical scales.
  derivedWeight = canon(derivedWeight, WEIGHT_SCALE);
  derivedVolume = canon(derivedVolume, VOLUME_SCALE);
  const statedWeight = canon(cargo.stated_total_weight ? toKg(cargo.stated_total_weight) : null, WEIGHT_SCALE);
  const statedVolume = canon(cargo.stated_total_volume ? toCbm(cargo.stated_total_volume) : null, VOLUME_SCALE);

  const conflicts: ("weight" | "volume")[] = [];
  if (derivedWeight && statedWeight && differsBeyondTolerance(derivedWeight, statedWeight)) conflicts.push("weight");
  if (derivedVolume && statedVolume && differsBeyondTolerance(derivedVolume, statedVolume)) conflicts.push("volume");

  const weight = derivedWeight ?? statedWeight;
  const volume = derivedVolume ?? statedVolume;
  const oversize: ("weight" | "volume")[] = [];
  if ([derivedWeight, statedWeight].some((w) => w && w.cmp(MAX_TOTAL_WEIGHT_KG) > 0)) oversize.push("weight");
  if ([derivedVolume, statedVolume].some((v) => v && v.cmp(MAX_TOTAL_VOLUME_CBM) > 0)) oversize.push("volume");

  return {
    containers: cargo.containers.map((c) => ({ raw: c.type_raw, iso: normalizeEquipment(c.type_raw), qty: c.qty })),
    pieces,
    weight_kg: weight,
    volume_cbm: volume,
    conflicts,
    oversize,
  };
}
