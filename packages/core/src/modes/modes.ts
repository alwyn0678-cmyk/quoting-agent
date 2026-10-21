import { Dec } from "../money/dec.js";
import { teuOf, type IsoType } from "../places/equipment.js";
import type { NormalizedCargo } from "../request/normalize.js";
import type { RequestField } from "../request/schema.js";
import type { TariffMode } from "../tariff/model.js";

/**
 * Mode modules: what a mode needs to be priceable (completeness) and the chargeable quantities it
 * yields. Charge evaluation is generic over the charge basis, so a new mode adds a module, not maths.
 */

export interface Quantities {
  containers: Partial<Record<IsoType, number>>;
  teu: Dec;
  /** LCL: exact tonnes and m³ (from canonical kg 3 dp / m³ 6 dp); revenue tons = max(t, m³) rounded
   *  UP to 3 dp (ASSUMPTIONS.md H2) — the only chargeable-quantity rounding. */
  weight_tonnes: Dec | null;
  volume_cbm: Dec | null;
  revenue_tons: Dec | null;
}

export interface ModeModule {
  mode: TariffMode;
  missingFields(cargo: NormalizedCargo): RequestField[];
  quantities(cargo: NormalizedCargo): Quantities;
}

const CHARGEABLE_SCALE = 3;
const KG_PER_TONNE = Dec.parse("1000");

/** Container/unit-priced modes share the same quantity rules (P1c adds mode-specific surcharges). */
const containerModule = (mode: TariffMode): ModeModule => ({
  mode,
  missingFields(cargo) {
    return cargo.containers.length === 0 || cargo.containers.some((c) => c.iso === null) ? ["containers"] : [];
  },
  quantities(cargo) {
    const containers: Partial<Record<IsoType, number>> = {};
    let teu = Dec.ZERO;
    for (const c of cargo.containers) {
      if (!c.iso) throw new Error("FCL quantities need resolved equipment (gate first)");
      containers[c.iso] = (containers[c.iso] ?? 0) + c.qty;
      teu = teu.add(Dec.fromInt(teuOf(c.iso) * c.qty));
    }
    return { containers, teu, weight_tonnes: null, volume_cbm: null, revenue_tons: null };
  },
});

const LCL: ModeModule = {
  mode: "LCL",
  missingFields(cargo) {
    const missing: RequestField[] = [];
    if (cargo.weight_kg === null) missing.push("weight");
    if (cargo.volume_cbm === null) missing.push("volume");
    return missing;
  },
  quantities(cargo) {
    if (cargo.weight_kg === null || cargo.volume_cbm === null) throw new Error("LCL quantities need weight and volume (gate first)");
    // kg → t is a division by 10^3: exact at three more decimal places.
    const tonnes = Dec.parse(Dec.divRound(cargo.weight_kg, KG_PER_TONNE, cargo.weight_kg.scale + 3, "FLOOR").toString());
    const volume = cargo.volume_cbm;
    return {
      containers: {},
      teu: Dec.ZERO,
      weight_tonnes: tonnes,
      volume_cbm: volume,
      revenue_tons: tonnes.max(volume).round(CHARGEABLE_SCALE, "CEILING"),
    };
  },
};

export const MODE_MODULES: Readonly<Partial<Record<string, ModeModule>>> = {
  FCL: containerModule("FCL"),
  LCL,
  BARGE: containerModule("BARGE"),
  RAIL: containerModule("RAIL"),
};

export function modeModule(mode: string): ModeModule | null {
  return MODE_MODULES[mode] ?? null;
}
