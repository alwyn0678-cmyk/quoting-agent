import { describe, it, expect } from "vitest";
import { decide, CONFIDENCE_THRESHOLD } from "./gate.js";
import type { ExtractionResult } from "./schemas.js";
import type { RateCard } from "./rate-card.js";

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
  it("Rotterdam -> Los Angeles (no card resolved) -> out_of_scope_lane", () => {
    // The engine's cardFor() returns null for an unsupported (mode, lane); the gate then escalates.
    expect(decide(x({ destination: { raw: "Los Angeles", port_code: "USLAX" } }), null)).toEqual({
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

describe("AC-B7 — gate generalised to mode + resolved card", () => {
  const bargeCard: RateCard = {
    mode: "BARGE",
    version: "2026-06-v1",
    validity_through: "2026-06-30",
    supported_lane: "NLRTM-DEDUI",
    base_per_container: { "40HC": 420 },
    surcharges: [{ code: "LWS", amount_per_container: 95 }],
    per_shipment_fees: [{ code: "DOC", amount: 35 }],
  };

  it("in-scope barge (resolved card) -> quote", () => {
    const ex = x({
      mode: "BARGE",
      origin: { raw: "Rotterdam", port_code: "NLRTM" },
      destination: { raw: "Duisburg", port_code: "DEDUI" },
      container_type: "40HC",
      container_qty: 1,
      overall_confidence: 0.9,
    });
    expect(decide(ex, bargeCard)).toEqual({ decision: "quote", reason: null });
  });

  it("AIR (basis not implemented) -> out_of_scope_mode", () => {
    const ex = x({
      mode: "AIR",
      origin: { raw: "Rotterdam", port_code: "NLRTM" },
      destination: { raw: "Duisburg", port_code: "DEDUI" },
    });
    expect(decide(ex, null)).toEqual({ decision: "escalate", reason: "out_of_scope_mode" });
  });

  it("priceable mode but no card (cardFor -> null) -> out_of_scope_lane", () => {
    const ex = x({
      mode: "BARGE",
      origin: { raw: "Rotterdam", port_code: "NLRTM" },
      destination: { raw: "New York", port_code: "USNYC" },
    });
    expect(decide(ex, null)).toEqual({ decision: "escalate", reason: "out_of_scope_lane" });
  });
});

describe("Gate-4 hardening — the gate never trusts a non-matching card (quote ⇒ priceable)", () => {
  const bargeCard: RateCard = {
    mode: "BARGE",
    version: "2026-06-v1",
    validity_through: "2026-06-30",
    supported_lane: "NLRTM-DEDUI",
    base_per_container: { "40HC": 420 }, // prices 40HC only — NOT 20GP/40GP
    surcharges: [{ code: "LWS", amount_per_container: 95 }],
    per_shipment_fees: [{ code: "DOC", amount: 35 }],
  };

  it("a BARGE request against the default FCL RATE_CARD (no card passed) -> out_of_scope_mode", () => {
    // Regression: decide()'s RATE_CARD default must not yield "quote" for a mode it cannot price.
    const ex = x({
      mode: "BARGE",
      origin: { raw: "Rotterdam", port_code: "NLRTM" },
      destination: { raw: "Duisburg", port_code: "DEDUI" },
      container_type: "40HC",
      container_qty: 1,
    });
    expect(decide(ex)).toEqual({ decision: "escalate", reason: "out_of_scope_mode" });
  });

  it("a non-null card for the WRONG lane -> out_of_scope_lane (not blind trust)", () => {
    const ex = x({
      mode: "BARGE",
      origin: { raw: "Rotterdam", port_code: "NLRTM" },
      destination: { raw: "New York", port_code: "USNYC" }, // card.supported_lane is NLRTM-DEDUI
      container_type: "40HC",
      container_qty: 1,
    });
    expect(decide(ex, bargeCard)).toEqual({ decision: "escalate", reason: "out_of_scope_lane" });
  });

  it("a matching card that does not PRICE the requested container -> out_of_scope_container", () => {
    // bargeCard prices 40HC only; a 20GP request would make priceQuote throw -> the gate escalates.
    const ex = x({
      mode: "BARGE",
      origin: { raw: "Rotterdam", port_code: "NLRTM" },
      destination: { raw: "Duisburg", port_code: "DEDUI" },
      container_type: "20GP",
      container_qty: 1,
    });
    expect(decide(ex, bargeCard)).toEqual({ decision: "escalate", reason: "out_of_scope_container" });
  });
});
