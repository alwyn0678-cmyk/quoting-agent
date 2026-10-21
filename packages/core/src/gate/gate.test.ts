import { describe, it, expect } from "vitest";
import { gateRequest } from "./gate.js";
import type { ShipmentRequest } from "../request/schema.js";

const req = (over: Partial<ShipmentRequest> = {}, cargo: Partial<ShipmentRequest["cargo"]> = {}): ShipmentRequest => ({
  mode: "FCL", service: "PORT_TO_PORT",
  origin: { raw: "Shanghai", unlocode: "CNSHA", iata: null, country: "CN", postcode: null },
  destination: { raw: "Rotterdam", unlocode: "NLRTM", iata: null, country: "NL", postcode: null },
  cargo: { containers: [{ type_raw: "40HC", qty: 2 }], pieces: [], stated_total_weight: null, stated_total_volume: null, commodity: "toys", dangerous_goods: null, temperature_controlled: null, ...cargo },
  incoterm: "FOB", ready_date: null, requester_name: "Wei", requester_company: "Acme", field_confidence: [], overall_confidence: 0.9,
  injection_detected: false, model_notes: { missing: [], conflicting: [] }, ...over,
});

describe("gate v2 — ordered, deterministic, named fields", () => {
  it("passes a complete port-to-port FCL request with price input", () => {
    const g = gateRequest(req());
    expect(g.pass).toBe(true);
    if (g.pass) expect(g.input).toMatchObject({ mode: "FCL", origin: "CNSHA", destination: "NLRTM" });
  });
  it("identity first: unresolved ports → missing_required_field naming them", () => {
    const g = gateRequest(req({ origin: { raw: "somewhere in China", unlocode: null, iata: null, country: "CN", postcode: null } }));
    expect(g).toMatchObject({ pass: false, reason: "missing_required_field", missing_fields: ["origin"] });
  });
  it("mode unknown → missing; mode without a module → out_of_scope_mode", () => {
    expect(gateRequest(req({ mode: "UNKNOWN" }))).toMatchObject({ reason: "missing_required_field", missing_fields: ["mode"] });
    expect(gateRequest(req({ mode: "AIR" }))).toMatchObject({ reason: "out_of_scope_mode" });
  });
  it("door services are out of scope in P1a; an unstated service is asked for", () => {
    expect(gateRequest(req({ service: "DOOR_TO_DOOR" }))).toMatchObject({ reason: "out_of_scope_service" });
    expect(gateRequest(req({ service: "UNKNOWN" }))).toMatchObject({ reason: "missing_required_field", missing_fields: ["service"] });
  });
  it("dangerous goods, temperature control or reefer equipment → out_of_scope_cargo", () => {
    expect(gateRequest(req({}, { dangerous_goods: true }))).toMatchObject({ reason: "out_of_scope_cargo" });
    expect(gateRequest(req({}, { temperature_controlled: true }))).toMatchObject({ reason: "out_of_scope_cargo" });
    expect(gateRequest(req({}, { containers: [{ type_raw: "40RF", qty: 1 }] }))).toMatchObject({ reason: "out_of_scope_cargo" });
  });
  it("completeness is mode-aware (FCL needs containers; LCL needs weight + volume)", () => {
    expect(gateRequest(req({}, { containers: [{ type_raw: "box", qty: 1 }] }))).toMatchObject({ reason: "missing_required_field", missing_fields: ["containers"] });
    expect(gateRequest(req({ mode: "LCL" }, { containers: [], stated_total_weight: { value: "800", unit: "kg" } }))).toMatchObject({ reason: "missing_required_field", missing_fields: ["volume"] });
  });
  it("conflicting cargo facts escalate rather than picking one", () => {
    const piece = { qty: 2, length: { value: "100", unit: "cm" as const }, width: { value: "100", unit: "cm" as const }, height: { value: "100", unit: "cm" as const }, weight_each: { value: "500", unit: "kg" as const }, stackable: true };
    const g = gateRequest(req({ mode: "LCL" }, { containers: [], pieces: [piece], stated_total_weight: { value: "2000", unit: "kg" } }));
    expect(g).toMatchObject({ reason: "conflicting_cargo" });
  });
});
