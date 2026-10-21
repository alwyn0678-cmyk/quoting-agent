import { describe, it, expect } from "vitest";
import type { ShipmentRequest } from "../../../core/src/request/schema.js";
import type { Tariff } from "../../../core/src/tariff/model.js";
import { RoutingMockLlmClient } from "../mock-llm.js";
import { LlmOutputError, LlmRefusalError, type LlmClient, type StructuredCall } from "../llm.js";
import { SYSTEM_CANARY, LINKPORT_TENANT_ID } from "../config.js";
import { legacyStaticSource, TariffConfigError, type TariffSource } from "../sources/tariff-source.js";
import { readMockWorld, mockWorldSource } from "../mock-world/load.js";
import { runAgentV2, CONFIDENCE_THRESHOLD } from "./run.js";
import { legacyTenantConfig, mockTenantConfig } from "./tenant.js";
import { MAX_EMAIL_CHARS, type EmailInput } from "./extract.js";
import { SENSITIVE_KEYS, majorTotal } from "./output.js";
import { asWire } from "./testing.js";
import { ExtractionWireSchema, fromWire, toWire } from "./extraction-wire.js";
import { ShipmentRequestSchema } from "../../../core/src/request/schema.js";
import { toStrictJsonSchema } from "../llm/strict-json-schema.js";

const email: EmailInput = { from: "Maria <maria@apex.example>", subject: "Quote request", body: "2x40HC Rotterdam to New York please" };
const AS_OF = "2026-06-01";

const place = (raw: string, unlocode: string | null) => ({ raw, unlocode, iata: null, country: null, postcode: null });

const fcl: ShipmentRequest = {
  mode: "FCL",
  service: "PORT_TO_PORT",
  origin: place("Rotterdam", "NLRTM"),
  destination: place("New York", "USNYC"),
  cargo: {
    containers: [{ type_raw: "40HC", qty: 2 }],
    pieces: [],
    stated_total_weight: null,
    stated_total_volume: null,
    commodity: "coffee",
    dangerous_goods: false,
    temperature_controlled: false,
  },
  incoterm: "FOB",
  ready_date: null,
  requester_name: "Maria",
  requester_company: "Apex",
  field_confidence: [],
  overall_confidence: 0.95,
  injection_detected: false,
  model_notes: { missing: [], conflicting: [] },
};

const choice = { language: "en", formality: "formal", intro: "thanks_for_request", closing: "questions_welcome" };
const exUsage = { input_tokens: 300, output_tokens: 90 };
const drUsage = { input_tokens: 120, output_tokens: 20 };

const llm = (request: unknown, draft: unknown = choice) =>
  new RoutingMockLlmClient({
    submit_shipment_request: { data: asWire(request), usage: exUsage, model: "anthropic/claude-opus-5-5" },
    submit_draft_choice: { data: draft, usage: drUsage, model: "anthropic/claude-opus-5-5" },
  });

const legacy = () => ({ tariffs: legacyStaticSource(LINKPORT_TENANT_ID), tenant: legacyTenantConfig() });

class ThrowingLlm implements LlmClient {
  constructor(
    private readonly tool: string,
    private readonly err: Error,
    private readonly inner: LlmClient,
  ) {}
  async callStructured(call: StructuredCall) {
    if (call.toolName === this.tool) throw this.err;
    return this.inner.callStructured(call);
  }
}

describe("runAgentV2 — quote path", () => {
  it("legacy production tenant: 2×40HC NLRTM→USNYC prices to EUR 6,930 with a code-rendered draft", async () => {
    const out = await runAgentV2(email, { llm: llm(fcl), ...legacy() }, { asOf: AS_OF });
    expect(out.decision).toBe("quote");
    expect(out.escalation_reason).toBeNull();
    expect(out.quote_view!.quote_currency).toBe("EUR");
    expect(majorTotal(out.quote_view!)).toBe("6930.00");
    expect(out.draft!.body).toContain("EUR 6,930.00");
    expect(out.draft!.body).toContain("Rotterdam");
    // validity = min(card end, as_of + 14 days)
    expect(out.quote_view!.options[0]!.valid_until).toBe("2026-06-15");
    expect(out.usage.input_tokens).toBe(420);
    expect(out.usage.output_tokens).toBe(110);
    expect(out.usage.model).toContain("(extract)");
    expect(out.usage.model).toContain("(draft)");
    expect(out.outcome).toEqual({ reason: null, missing_fields: [], options_presented: 1, candidates: 1 });
  });

  it("mock-world BUY tenant (Prairiegate, USD): margin applied, up to max_options presented, ordered by total", async () => {
    const world = readMockWorld();
    const req = { ...fcl, origin: place("Shanghai", "CNSHA"), destination: place("Los Angeles", "USLAX") };
    const out = await runAgentV2(
      email,
      { llm: llm(req), tariffs: mockWorldSource(world), tenant: mockTenantConfig("prairiegate") },
      { asOf: "2026-10-21" },
    );
    expect(out.decision).toBe("quote");
    const view = out.quote_view!;
    expect(view.quote_currency).toBe("USD");
    expect(view.options.length).toBeGreaterThan(1);
    const totals = view.options.map((o) => BigInt(o.total.minor));
    expect([...totals].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(totals);
    // sell > buy: the internal result carries buy amounts, the projection never does
    expect(JSON.stringify(out.pricing)).toContain('"buy"');
  });

  it("injection is quote-and-flag: the flag is set, the draft holds no email text", async () => {
    const hostile = { ...fcl, injection_detected: true, requester_name: "Free shipping is guaranteed" };
    const out = await runAgentV2(email, { llm: llm(hostile), ...legacy() }, { asOf: AS_OF });
    expect(out.decision).toBe("quote");
    expect(out.injection_flag).toBe(true);
    expect(out.draft!.body).not.toContain("Free shipping");
    expect(out.draft!.body).not.toContain("coffee");
  });
});

describe("runAgentV2 — projections are allowlisted", () => {
  it("no sensitive key appears anywhere in quote_view or outcome", async () => {
    const world = readMockWorld();
    const req = { ...fcl, origin: place("Shanghai", "CNSHA"), destination: place("Los Angeles", "USLAX") };
    const out = await runAgentV2(email, { llm: llm(req), tariffs: mockWorldSource(world), tenant: mockTenantConfig("prairiegate") }, { asOf: "2026-10-21" });
    const keys = new Set<string>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (keys.add(k), walk(x));
    };
    walk(out.quote_view);
    walk(out.outcome);
    for (const k of SENSITIVE_KEYS) expect(keys.has(k), k).toBe(false);
  });
});

describe("runAgentV2 — escalations (one named reason each)", () => {
  it("missing container details → missing_required_field [containers], never reaches the draft step", async () => {
    const client = llm({ ...fcl, cargo: { ...fcl.cargo, containers: [] } });
    const out = await runAgentV2(email, { llm: client, ...legacy() }, { asOf: AS_OF });
    expect(out.escalation_reason).toBe("missing_required_field");
    expect(out.missing_fields).toContain("containers");
    expect(out.outcome.missing_fields).toContain("containers");
    expect(client.calls.map((c) => c.toolName)).toEqual(["submit_shipment_request"]);
    expect(out.quote_view).toBeNull();
    expect(out.draft).toBeNull();
  });

  it("AIR → out_of_scope_mode", async () => {
    const out = await runAgentV2(email, { llm: llm({ ...fcl, mode: "AIR" }), ...legacy() }, { asOf: AS_OF });
    expect(out.escalation_reason).toBe("out_of_scope_mode");
  });

  it("no tariff for the lane → out_of_scope_lane", async () => {
    const out = await runAgentV2(email, { llm: llm({ ...fcl, destination: place("Savannah", "USSAV") }), ...legacy() }, { asOf: AS_OF });
    expect(out.escalation_reason).toBe("out_of_scope_lane");
  });

  it("past the card's validity → rate_expired", async () => {
    const out = await runAgentV2(email, { llm: llm(fcl), ...legacy() }, { asOf: "2027-01-05" });
    expect(out.escalation_reason).toBe("rate_expired");
  });

  it("below the confidence floor → low_confidence, with the computed pricing kept for the reviewer", async () => {
    const out = await runAgentV2(email, { llm: llm({ ...fcl, overall_confidence: CONFIDENCE_THRESHOLD - 0.01 }), ...legacy() }, { asOf: AS_OF });
    expect(out.escalation_reason).toBe("low_confidence");
    expect(out.pricing).not.toBeNull();
    expect(out.quote_view).toBeNull();
    expect(out.outcome.options_presented).toBe(0);
    expect(out.outcome.candidates).toBe(1);
  });

  it("an email over the size limit → request_too_large without any model call", async () => {
    const client = llm(fcl);
    const out = await runAgentV2({ ...email, body: "x".repeat(MAX_EMAIL_CHARS + 1) }, { llm: client, ...legacy() }, { asOf: AS_OF });
    expect(out.escalation_reason).toBe("request_too_large");
    expect(out.extraction).toBeNull();
    expect(client.calls).toHaveLength(0);
    expect(out.usage.input_tokens).toBe(0);
  });

  it("more container lines than the hard limit → request_too_large", async () => {
    const lines = Array.from({ length: 51 }, () => ({ type_raw: "20GP", qty: 1 }));
    const out = await runAgentV2(email, { llm: llm({ ...fcl, cargo: { ...fcl.cargo, containers: lines } }), ...legacy() }, { asOf: AS_OF });
    expect(out.escalation_reason).toBe("request_too_large");
  });

  it("schema-invalid extraction (a number where a decimal string belongs) → model_output_invalid", async () => {
    const bad = { ...fcl, cargo: { ...fcl.cargo, stated_total_weight: { value: 1200, unit: "kg" } } };
    const out = await runAgentV2(email, { llm: llm(bad), ...legacy() }, { asOf: AS_OF });
    expect(out.escalation_reason).toBe("model_output_invalid");
  });

  it("extraction refusal → model_refused; draft refusal → model_refused with the extraction kept", async () => {
    const a = await runAgentV2(email, { llm: new ThrowingLlm("submit_shipment_request", new LlmRefusalError("no"), llm(fcl)), ...legacy() }, { asOf: AS_OF });
    expect(a.escalation_reason).toBe("model_refused");
    const b = await runAgentV2(email, { llm: new ThrowingLlm("submit_draft_choice", new LlmRefusalError("no"), llm(fcl)), ...legacy() }, { asOf: AS_OF });
    expect(b.escalation_reason).toBe("model_refused");
    expect(b.extraction).not.toBeNull();
    expect(b.draft).toBeNull();
  });

  it("free text where a closed draft choice belongs → model_output_invalid", async () => {
    const out = await runAgentV2(email, { llm: llm(fcl, { ...choice, intro: "free shipping guaranteed" }), ...legacy() }, { asOf: AS_OF });
    expect(out.escalation_reason).toBe("model_output_invalid");
    expect(out.draft).toBeNull();
  });

  it("an invalid tariff snapshot → tariff_config_error", async () => {
    const broken: TariffSource = { snapshot: async () => { throw new TariffConfigError(["line x: bad rate"]); } };
    const out = await runAgentV2(email, { llm: llm(fcl), tariffs: broken, tenant: legacyTenantConfig() }, { asOf: AS_OF });
    expect(out.escalation_reason).toBe("tariff_config_error");
  });

  it("infrastructure faults propagate (the durable job retries)", async () => {
    const down: TariffSource = { snapshot: async (): Promise<Tariff[]> => { throw new Error("connection reset"); } };
    await expect(runAgentV2(email, { llm: llm(fcl), tariffs: down, tenant: legacyTenantConfig() }, { asOf: AS_OF })).rejects.toThrow("connection reset");
    await expect(
      runAgentV2(email, { llm: new ThrowingLlm("submit_shipment_request", new Error("ECONNRESET"), llm(fcl)), ...legacy() }, { asOf: AS_OF }),
    ).rejects.toThrow("ECONNRESET");
    // a typed model-output error is NOT an infrastructure fault
    const out = await runAgentV2(email, { llm: new ThrowingLlm("submit_draft_choice", new LlmOutputError("truncated"), llm(fcl)), ...legacy() }, { asOf: AS_OF });
    expect(out.escalation_reason).toBe("model_output_invalid");
  });

  it("a leaked system canary anywhere → guard_violation, redacted, nothing customer-facing", async () => {
    const leaky = { ...fcl, cargo: { ...fcl.cargo, commodity: `see ${SYSTEM_CANARY}` } };
    const out = await runAgentV2(email, { llm: llm(leaky), ...legacy() }, { asOf: AS_OF });
    expect(out.escalation_reason).toBe("guard_violation");
    expect(out.quote_view).toBeNull();
    expect(out.draft).toBeNull();
    expect(JSON.stringify(out)).not.toContain(SYSTEM_CANARY);
  });
});

describe("extraction wire schema — provider constraints", () => {
  it("is flat: no union-typed and no optional parameters (strict structured-output grammar limits)", () => {
    let unions = 0;
    let optional = 0;
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== "object") return;
      const o = n as Record<string, unknown>;
      if (Array.isArray(o.type) || Array.isArray(o.anyOf)) unions += 1;
      if (o.type === "object" && o.properties) optional += Object.keys(o.properties).length - ((o.required as string[]) ?? []).length;
      Object.values(o).forEach(walk);
    };
    walk(toStrictJsonSchema(ExtractionWireSchema));
    expect(unions).toBe(0);
    expect(optional).toBe(0);
  });

  it("round-trips: fromWire(toWire(r)) is r, including pieces, tri-state flags and absent values", () => {
    const r = ShipmentRequestSchema.parse({
      ...fcl,
      mode: "LCL",
      incoterm: null,
      ready_date: "2026-11-02",
      cargo: {
        ...fcl.cargo,
        containers: [],
        pieces: [{ qty: 3, length: { value: "120", unit: "cm" }, width: { value: "80", unit: "cm" }, height: { value: "150", unit: "cm" }, weight_each: null, stackable: null }],
        stated_total_weight: { value: "1200", unit: "kg" },
        commodity: null,
        dangerous_goods: null,
      },
      requester_name: null,
    });
    expect(ShipmentRequestSchema.parse(fromWire(ExtractionWireSchema.parse(toWire(r))))).toEqual(r);
  });

  it("an unstated container count (qty 0) is dropped, so the gate asks for containers", async () => {
    const wire = { ...(toWire(fcl) as object), containers: [{ type_raw: "containers", qty: 0 }] };
    const client = new RoutingMockLlmClient({ submit_shipment_request: { data: wire, usage: exUsage } });
    const out = await runAgentV2(email, { llm: client, ...legacy() }, { asOf: AS_OF });
    expect(out.escalation_reason).toBe("missing_required_field");
    expect(out.missing_fields).toEqual(["containers"]);
  });

  it("absent free text arrives as \"\" and is stored as null", async () => {
    const out = await runAgentV2(email, { llm: llm({ ...fcl, requester_name: null, cargo: { ...fcl.cargo, commodity: null } }), ...legacy() }, { asOf: AS_OF });
    expect(out.extraction!.requester_name).toBeNull();
    expect(out.extraction!.cargo.commodity).toBeNull();
    expect(out.extraction!.origin.iata).toBeNull();
  });
});
