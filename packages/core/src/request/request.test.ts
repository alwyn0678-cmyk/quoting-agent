import { describe, it, expect } from "vitest";
import { ShipmentRequestSchema, type ShipmentRequest, type Piece } from "./schema.js";
import { normalizeCargo, CONFLICT_TOLERANCE } from "./normalize.js";

const base: ShipmentRequest = {
  mode: "LCL",
  service: "PORT_TO_PORT",
  origin: { raw: "Shanghai", unlocode: "CNSHA", iata: null, country: "CN", postcode: null },
  destination: { raw: "Rotterdam", unlocode: "NLRTM", iata: null, country: "NL", postcode: null },
  cargo: {
    containers: [],
    pieces: [],
    stated_total_weight: null,
    stated_total_volume: null,
    commodity: "machine parts",
    dangerous_goods: null,
    temperature_controlled: null,
  },
  incoterm: "FOB",
  ready_date: "2026-11-10",
  requester_name: "Lena",
  requester_company: "Acme",
  field_confidence: [],
  overall_confidence: 0.9,
  injection_detected: false,
  model_notes: { missing: [], conflicting: [] },
};
const piece = (over: Record<string, unknown> = {}): Piece => ({
  qty: 3,
  length: { value: "120", unit: "cm" },
  width: { value: "80", unit: "cm" },
  height: { value: "150", unit: "cm" },
  weight_each: { value: "400", unit: "kg" },
  stackable: false,
  ...over,
}) as Piece;

describe("request v2 schema — exact transport, hard limits, positive measures", () => {
  it("accepts a well-formed request", () => {
    expect(ShipmentRequestSchema.safeParse(base).success).toBe(true);
  });
  it("rejects JSON numbers for measurements (decimal strings only)", () => {
    const bad = { ...base, cargo: { ...base.cargo, pieces: [piece({ length: { value: 120, unit: "cm" } })] } };
    expect(ShipmentRequestSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects zero/negative measurements and unknown units", () => {
    for (const p of [piece({ height: { value: "0", unit: "cm" } }), piece({ height: { value: "-1", unit: "cm" } }), piece({ height: { value: "1", unit: "yd" } })]) {
      expect(ShipmentRequestSchema.safeParse({ ...base, cargo: { ...base.cargo, pieces: [p] } }).success).toBe(false);
    }
  });
  it("enforces collection limits (≤ 500 piece lines, ≤ 50 container lines)", () => {
    const many = Array.from({ length: 501 }, () => piece());
    expect(ShipmentRequestSchema.safeParse({ ...base, cargo: { ...base.cargo, pieces: many } }).success).toBe(false);
  });
});

describe("cargo normalisation — code does every conversion, exactly", () => {
  it("derives total weight and volume from pieces (3 × 120×80×150 cm, 400 kg each)", () => {
    const n = normalizeCargo({ ...base.cargo, pieces: [piece()] });
    expect(n.weight_kg?.toString()).toBe("1200");
    expect(n.volume_cbm?.toString()).toBe("4.32");
    expect(n.conflicts).toEqual([]);
  });
  it("converts imperial units with exact constants (1 lb = 0.45359237 kg, 1 in = 2.54 cm)", () => {
    const n = normalizeCargo({
      ...base.cargo,
      pieces: [piece({ qty: 1, length: { value: "48", unit: "in" }, width: { value: "40", unit: "in" }, height: { value: "50", unit: "in" }, weight_each: { value: "1000", unit: "lb" } })],
    });
    // exact: 453.59237 kg and 1,573,158.144 cm³ (verified with Python Decimal) → canonical 3 dp / 6 dp
    expect(n.weight_kg?.toString()).toBe("453.592");
    expect(n.volume_cbm?.toString()).toBe("1.573158");
  });
  it("maps container text to ISO types in code (the model never picks codes)", () => {
    const n = normalizeCargo({ ...base.cargo, containers: [{ type_raw: "40' HQ", qty: 2 }, { type_raw: "box", qty: 1 }] });
    expect(n.containers).toEqual([{ raw: "40' HQ", iso: "45G1", qty: 2 }, { raw: "box", iso: null, qty: 1 }]);
  });
  it("uses stated totals when there are no pieces", () => {
    const n = normalizeCargo({ ...base.cargo, stated_total_weight: { value: "1.2", unit: "t" }, stated_total_volume: { value: "3.5", unit: "cbm" } });
    expect(n.weight_kg?.toString()).toBe("1200");
    expect(n.volume_cbm?.toString()).toBe("3.5");
  });
  it(`flags a stated total that differs from the derived one by more than ${CONFLICT_TOLERANCE.toString()}`, () => {
    const n = normalizeCargo({ ...base.cargo, pieces: [piece()], stated_total_weight: { value: "1500", unit: "kg" } });
    expect(n.conflicts).toEqual(["weight"]);
    const ok = normalizeCargo({ ...base.cargo, pieces: [piece()], stated_total_weight: { value: "1210", unit: "kg" } });
    expect(ok.conflicts).toEqual([]);
  });
  it("a piece without weight leaves derived weight unknown (not zero)", () => {
    const n = normalizeCargo({ ...base.cargo, pieces: [piece({ weight_each: null })] });
    expect(n.weight_kg).toBeNull();
  });
});

describe("Codex review (core 1–4) — request hardening", () => {
  it("#10 extraction objects are strict (unknown keys rejected) and 'mm' is not an allowed unit", () => {
    const extra = { ...base, cargo: { ...base.cargo, pieces: [{ ...piece(), legacy_length: 12 }] } };
    expect(ShipmentRequestSchema.safeParse(extra).success).toBe(false);
    const mm = { ...base, cargo: { ...base.cargo, pieces: [piece({ length: { value: "1", unit: "mm" } })] } };
    expect(ShipmentRequestSchema.safeParse(mm).success).toBe(false);
  });
  it("#8 ready_date must be a real calendar date", () => {
    expect(ShipmentRequestSchema.safeParse({ ...base, ready_date: "2026-02-31" }).success).toBe(false);
  });
  it("#4 normalised totals use canonical scales: weight 3 dp, volume 6 dp", () => {
    const n = normalizeCargo({
      ...base.cargo,
      pieces: [piece({ qty: 1, length: { value: "48", unit: "in" }, width: { value: "40", unit: "in" }, height: { value: "50", unit: "in" }, weight_each: { value: "1000", unit: "lb" } })],
    });
    expect(n.weight_kg?.toString()).toBe("453.592");
    expect(n.volume_cbm?.toString()).toBe("1.573158");
  });
});
