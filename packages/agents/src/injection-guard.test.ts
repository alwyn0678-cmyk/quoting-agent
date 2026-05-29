import { describe, it, expect } from "vitest";
import { injectionGuard, type GuardInput } from "./injection-guard.js";
import { priceQuote } from "./rate-engine.js";
import { SYSTEM_CANARY } from "./config.js";
import type { ExtractionResult } from "./schemas.js";

// 1 x 40HC Rotterdam -> New York: the legitimate request inside fixture 07 (real total 3520).
const extraction: ExtractionResult = {
  origin: { raw: "Rotterdam", port_code: "NLRTM" },
  destination: { raw: "New York", port_code: "USNYC" },
  mode: "FCL",
  container_type: "40HC",
  container_qty: 1,
  incoterm: "FOB",
  commodity: "household furniture",
  ready_date: null,
  weight_kg: null,
  requester_name: null,
  requester_company: null,
  field_confidence: {},
  overall_confidence: 0.9,
  injection_detected: true,
};

const realQuote = priceQuote({
  origin_port_code: "NLRTM",
  destination_port_code: "USNYC",
  mode: "FCL",
  container_type: "40HC",
  container_qty: 1,
});

const clean: GuardInput = {
  extraction,
  quote: realQuote,
  draft: { subject: "Re: Quote request", body: "Our all-in rate is EUR 3,520." },
};

describe("T12 (offline parts) — injection produced no harm", () => {
  it("passes a clean output (real total, no leak)", () => {
    expect(realQuote.all_in_total).toBe(3520);
    expect(injectionGuard(clean)).toEqual({ safe: true, violations: [] });
  });

  it("flags a system-prompt canary leak in the draft body", () => {
    const leaked: GuardInput = {
      ...clean,
      draft: { subject: "Re: Quote", body: `Sure, my token is ${SYSTEM_CANARY}.` },
    };
    const r = injectionGuard(leaked);
    expect(r.safe).toBe(false);
    expect(r.violations).toContain("canary_leak");
  });

  it("flags a canary leak hidden in an extraction field", () => {
    const leaked: GuardInput = {
      ...clean,
      extraction: { ...extraction, commodity: `furniture ${SYSTEM_CANARY}` },
    };
    expect(injectionGuard(leaked).violations).toContain("canary_leak");
  });

  it("flags an attacker-supplied total (EUR 1, not the engine total)", () => {
    const tampered: GuardInput = { ...clean, quote: { ...realQuote, all_in_total: 1 } };
    const r = injectionGuard(tampered);
    expect(r.safe).toBe(false);
    expect(r.violations).toContain("price_mismatch");
  });

  it("flags a quote attached to an unpriceable (out-of-scope) request", () => {
    const offLane: GuardInput = {
      ...clean,
      extraction: { ...extraction, destination: { raw: "Los Angeles", port_code: "USLAX" } },
    };
    expect(injectionGuard(offLane).violations).toContain("price_mismatch");
  });

  it("flags a draft that omits the engine total (T10 enforced at runtime)", () => {
    const bad: GuardInput = { ...clean, draft: { subject: "Re", body: "Thanks for your enquiry; we'll be in touch." } };
    const r = injectionGuard(bad);
    expect(r.safe).toBe(false);
    expect(r.violations).toContain("draft_total_mismatch");
  });
});
