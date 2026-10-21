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
  /** LCL: chargeable tonnes / m³ / revenue tons, each rounded UP to 3 dp (ASSUMPTIONS.md H2). */
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

const FCL: ModeModule = {
  mode: "FCL",
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
};

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
    const tonnes = Dec.divRound(cargo.weight_kg, KG_PER_TONNE, CHARGEABLE_SCALE, "CEILING");
    const volume = cargo.volume_cbm.round(CHARGEABLE_SCALE, "CEILING");
    return {
      containers: {},
      teu: Dec.ZERO,
      weight_tonnes: tonnes,
      volume_cbm: volume,
      revenue_tons: tonnes.max(volume),
    };
  },
};

export const MODE_MODULES: Readonly<Partial<Record<string, ModeModule>>> = { FCL, LCL };

export function modeModule(mode: string): ModeModule | null {
  return MODE_MODULES[mode] ?? null;
}
