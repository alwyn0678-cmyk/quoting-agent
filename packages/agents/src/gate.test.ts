import { describe, it, expect } from "vitest";
import { decide, CONFIDENCE_THRESHOLD } from "./gate.js";
import type { ExtractionResult } from "./schemas.js";

const complete: ExtractionResult = {
  origin: { raw: "Rotterdam", port_code: "NLRTM" },
  destination: { raw: "New York", port_code: "USNYC" },
  mode: "FCL",
  container_type: "40HC",
  container_qty: 2,
  incoterm: "FOB",
  commodity: "roasted coffee",
  ready_date: "2026-06-12",
  weight_kg: 21000,
  requester_name: "Maria Jansen",
  requester_company: "Apex Coffee Importers",
  field_confidence: {},
  overall_confidence: 0.95,
  injection_detected: false,
};
const x = (over: Partial<ExtractionResult>): ExtractionResult => ({ ...complete, ...over });

describe("T9 — quote when complete and in scope", () => {
  it("returns quote with no reason", () => {
    expect(decide(complete)).toEqual({ decision: "quote", reason: null });
  });
});

describe("T6 — escalate on missing required field", () => {
  it("missing container type (UNKNOWN) -> missing_required_field", () => {
    expect(decide(x({ container_type: "UNKNOWN", container_qty: null }))).toEqual({
      decision: "escalate",
      reason: "missing_required_field",
    });
  });
  it("missing quantity -> missing_required_field", () => {
    expect(decide(x({ container_qty: null }))).toEqual({
      decision: "escalate",
      reason: "missing_required_field",
    });
  });
  it("missing origin port code -> missing_required_field", () => {
    expect(decide(x({ origin: { raw: "?", port_code: null } }))).toEqual({
      decision: "escalate",
      reason: "missing_required_field",
    });
  });
});

describe("T7 — escalate on out-of-scope lane", () => {
  it("Rotterdam -> Los Angeles -> out_of_scope_lane", () => {
    expect(decide(x({ destination: { raw: "Los Angeles", port_code: "USLAX" } }))).toEqual({
      decision: "escalate",
      reason: "out_of_scope_lane",
    });
  });
});

describe("T8 — escalate on out-of-scope mode", () => {
  it("LCL with no container details -> out_of_scope_mode (mode precedence over missing field)", () => {
    expect(decide(x({ mode: "LCL", container_type: null, container_qty: null }))).toEqual({
      decision: "escalate",
      reason: "out_of_scope_mode",
    });
  });
});

describe("confidence floor (ASSUMPTIONS E1)", () => {
  it(`below ${CONFIDENCE_THRESHOLD} -> low_confidence`, () => {
    expect(decide(x({ overall_confidence: 0.5 }))).toEqual({
      decision: "escalate",
      reason: "low_confidence",
    });
  });
  it("exactly at threshold still quotes", () => {
    expect(decide(x({ overall_confidence: CONFIDENCE_THRESHOLD }))).toEqual({
      decision: "quote",
      reason: null,
    });
  });
});
