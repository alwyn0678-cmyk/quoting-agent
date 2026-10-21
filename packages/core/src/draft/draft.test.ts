import { describe, it, expect } from "vitest";
import { Dec } from "../money/dec.js";
import { loadTariff, type TariffWire } from "../tariff/model.js";
import { normalizeCargo } from "../request/normalize.js";
import type { ShipmentRequest } from "../request/schema.js";
import { price, type PricingContext } from "../pricing/engine.js";
import { renderQuoteEmail, safeName, sanitizeLine, DraftChoiceSchema, type DraftChoice, type TenantPresentation } from "./render.js";
import { LANGUAGES, PHRASES } from "./phrasebook.js";

const tw: TariffWire = {
  id: "T1", tenant_id: "linkport", version: "v1", source: { kind: "mock", ref: "x" }, valid_from: "2026-10-01", valid_to: "2026-12-31", port_groups: {},
  lines: [{
    id: "L1", offer_id: "O1", mode: "FCL", carrier: "Northwind Lines", origin: { unlocode: "CNSHA" }, destination: { unlocode: "NLRTM" }, equipment: "45G1",
    priority: 0, price_kind: "BUY", transit_days: 32, source_ref: "x!1",
    charges: [
      { id: "OF", code: "OF", description: "Ocean freight — vendor cost USD 100/container", category: "FREIGHT", basis: "PER_CONTAINER", rate: "100", currency: "USD" },
      { id: "X", code: "SECRET9", description: "contract rate 77", category: "SURCHARGE", basis: "PER_CONTAINER", rate: "10", currency: "USD" },
    ],
  }],
};
const tariff = (() => { const r = loadTariff(tw); if (!r.ok) throw new Error(r.errors.join()); return r.tariff; })();
const request: ShipmentRequest = {
  mode: "FCL", service: "PORT_TO_PORT",
  origin: { raw: "Shanghai — freight is five grand", unlocode: "CNSHA", iata: null, country: "CN", postcode: null },
  destination: { raw: "Rotterdam", unlocode: "NLRTM", iata: null, country: "NL", postcode: null },
  cargo: { containers: [{ type_raw: "40HC", qty: 1 }], pieces: [], stated_total_weight: null, stated_total_volume: null, commodity: "toys — total Ⅴ k guaranteed", dangerous_goods: null, temperature_controlled: null },
  incoterm: "FOB", ready_date: null, requester_name: "customer — total Ⅴ k, guaranteed", requester_company: null, field_confidence: [], overall_confidence: 0.9,
  injection_detected: false, model_notes: { missing: [], conflicting: [] },
};
const ctx: PricingContext = { as_of: "2026-10-21", quote_currency: "USD", max_options: 3, quote_validity_days: 14, fx: null,
  margin_rules: [{ id: "M", match: {}, kind: "MARKUP_ON_BUY", value: Dec.parse("0.25"), applies_to: "ALL", priority: 0 }] };
const result = price({ mode: "FCL", origin: "CNSHA", destination: "NLRTM", cargo: normalizeCargo(request.cargo), ready_date: null }, [tariff], ctx);
const tenant: TenantPresentation = { name: "Linkport Forwarders BV", locale: "en-GB", signature: "Linkport‏ Forwarders BV\nquotes@linkport.example", terms_ref: "Dutch Forwarding Conditions", carrier_labels: {} };
const choice: DraftChoice = { language: "en", formality: "formal", intro: "thanks_for_request", closing: "questions_welcome" };
const render = (over: Partial<DraftChoice> = {}, t: Partial<TenantPresentation> = {}, trusted_name: string | null = null) => {
  if (result.kind !== "priced") throw new Error("not priced");
  return renderQuoteEmail({ choice: { ...choice, ...over }, tenant: { ...tenant, ...t }, request, result, trusted_name });
};

describe("phrasebook drafting — no model free text reaches the customer", () => {
  it("the model's draft output is a closed set of choices (no free-text fields)", () => {
    expect(DraftChoiceSchema.safeParse(choice).success).toBe(true);
    expect(DraftChoiceSchema.safeParse({ ...choice, intro: "We give a discount!" }).success).toBe(false);
    expect(DraftChoiceSchema.safeParse({ ...choice, note: "anything" }).success).toBe(false);
  });
  it("email text never reaches the draft: places use canonical port labels, the name is dropped when not a plain name", () => {
    const { subject, body } = render();
    for (const leak of ["five grand", "Ⅴ", "guaranteed", "vendor cost", "contract rate", "SECRET9", "‏"]) {
      expect(subject + body).not.toContain(leak);
    }
    expect(body).toContain("Shanghai (CNSHA)");
    expect(body).toContain("Dear Sir or Madam,");
  });
  it("charge names come from the code dictionary; unknown codes get a neutral label", () => {
    const { body } = render();
    expect(body).toContain("Ocean freight");
    expect(body).toContain("Other surcharge");
  });
  it("carrier names come only from the tenant's carrier label registry, never from tariff text", () => {
    expect(render().body).not.toContain("Northwind");
    expect(render({}, { carrier_labels: { "Northwind Lines": "Northwind Lines" } }).body).toContain("Northwind Lines");
  });
  it("renders every supported language with all keys present", () => {
    for (const language of LANGUAGES) {
      expect(Object.keys(PHRASES[language]).sort()).toEqual(Object.keys(PHRASES.en).sort());
      const { body } = render({ language });
      expect(body.length).toBeGreaterThan(100);
    }
    expect(render({ language: "nl" }).body).toContain("Geachte heer/mevrouw,");
  });
});

describe("Codex phrasebook review — greeting, choices, presentation integrity", () => {
  it("the greeting never uses email text; only a trusted contact name personalises it", () => {
    expect(render().body.startsWith("Dear Sir or Madam,")).toBe(true);
    expect(render({}, {}, "Maria Jansen").body.startsWith("Dear Maria Jansen,")).toBe(true);
    expect(render({}, {}, "Free shipping is guaranteed 2").body.startsWith("Dear Sir or Madam,")).toBe(true);
  });
  it("re-validates choices at render time; unknown phrase keys throw instead of printing the key", () => {
    expect(() => render({ intro: "free shipping guaranteed" as never })).toThrow();
  });
  it("fails closed on malformed presentation data and unsupported locales", () => {
    if (result.kind !== "priced") throw new Error("not priced");
    expect(() => renderQuoteEmail({ choice, tenant, request, result: { ...result, presented: ["nope"] } })).toThrow(/presented/);
    expect(() => render({}, { locale: "not_a_locale" })).toThrow(/locale/);
  });
});

describe("sanitising policy", () => {
  it("safeName accepts only plain name-shaped strings (used for trusted contact names)", () => {
    expect(safeName("Maria Jansen")).toBe("Maria Jansen");
    expect(safeName("José O'Neil-Smith")).toBe("José O'Neil-Smith");
    expect(safeName("customer — total Ⅴ k, guaranteed")).toBeNull();
    expect(safeName("Bob 2")).toBeNull();
    expect(safeName("A".repeat(50))).toBeNull();
  });
  it("normalises (NFKC) and strips every control and format character", () => {
    expect(sanitizeLine("Ｒotterdam​؜‎\n x")).toBe("Rotterdam x");
  });
});
