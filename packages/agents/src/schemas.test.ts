import { describe, it, expect } from "vitest";
import {
  ExtractionResultSchema,
  RateQuoteSchema,
  AgentOutputSchema,
  type ExtractionResult,
  type RateQuote,
  type AgentOutput,
} from "./schemas.js";

const validExtraction: ExtractionResult = {
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
  field_confidence: { origin: 0.99, destination: 0.99, mode: 0.98, container_type: 0.97, container_qty: 0.99 },
  overall_confidence: 0.97,
  injection_detected: false,
};

const validQuote: RateQuote = {
  currency: "EUR",
  lane: "NLRTM-USNYC",
  rate_card_version: "2026-06-v1",
  container_type: "40HC",
  container_qty: 2,
  base_per_container: 2550,
  surcharges: [
    { code: "BAF", amount_per_container: 320 },
    { code: "THC_RTM", amount_per_container: 225 },
    { code: "THC_NYC", amount_per_container: 290 },
    { code: "ISPS", amount_per_container: 25 },
  ],
  per_shipment_fees: [
    { code: "DOC", amount: 65 },
    { code: "EXPORT_CUSTOMS", amount: 45 },
  ],
  all_in_total: 6930,
  validity_through: "2026-06-30",
};

const validQuoteOutput: AgentOutput = {
  decision: "quote",
  extraction: validExtraction,
  injection_flag: false,
  escalation_reason: null,
  quote: validQuote,
  draft: { subject: "Re: Quote request", body: "Dear Maria, ..." },
  usage: { model: "claude-opus-4-8", input_tokens: 1200, output_tokens: 350, est_cost_usd: 0.03 },
};

const validEscalateOutput: AgentOutput = {
  decision: "escalate",
  extraction: { ...validExtraction, container_type: "UNKNOWN", container_qty: null, overall_confidence: 0.4 },
  injection_flag: false,
  escalation_reason: "missing_required_field",
  quote: null,
  draft: null,
  usage: { model: "claude-opus-4-8", input_tokens: 1000, output_tokens: 50, est_cost_usd: 0.01 },
};

describe("ExtractionResultSchema", () => {
  it("parses a valid extraction", () => {
    expect(() => ExtractionResultSchema.parse(validExtraction)).not.toThrow();
  });
  it("rejects out-of-range confidence", () => {
    expect(ExtractionResultSchema.safeParse({ ...validExtraction, overall_confidence: 1.5 }).success).toBe(false);
  });
  it("rejects an unknown mode", () => {
    expect(ExtractionResultSchema.safeParse({ ...validExtraction, mode: "BOAT" }).success).toBe(false);
  });
  it("rejects a non-positive container_qty", () => {
    expect(ExtractionResultSchema.safeParse({ ...validExtraction, container_qty: 0 }).success).toBe(false);
  });
});

describe("RateQuoteSchema", () => {
  it("parses a valid quote", () => {
    expect(() => RateQuoteSchema.parse(validQuote)).not.toThrow();
  });
  it("rejects a non-EUR currency", () => {
    expect(RateQuoteSchema.safeParse({ ...validQuote, currency: "USD" }).success).toBe(false);
  });
  it("rejects a fractional (non-integer) amount", () => {
    expect(RateQuoteSchema.safeParse({ ...validQuote, base_per_container: 2550.5 }).success).toBe(false);
  });
  it("rejects a negative all_in_total", () => {
    expect(RateQuoteSchema.safeParse({ ...validQuote, all_in_total: -1 }).success).toBe(false);
  });
});

describe("AgentOutputSchema invariants", () => {
  it("parses a valid quote output", () => {
    expect(() => AgentOutputSchema.parse(validQuoteOutput)).not.toThrow();
  });
  it("parses a valid escalate output", () => {
    expect(() => AgentOutputSchema.parse(validEscalateOutput)).not.toThrow();
  });
  it("rejects decision 'quote' with a null quote", () => {
    expect(AgentOutputSchema.safeParse({ ...validQuoteOutput, quote: null }).success).toBe(false);
  });
  it("rejects decision 'escalate' carrying a quote", () => {
    expect(
      AgentOutputSchema.safeParse({ ...validEscalateOutput, quote: validQuote }).success,
    ).toBe(false);
  });
  it("rejects decision 'escalate' with a null reason", () => {
    expect(
      AgentOutputSchema.safeParse({ ...validEscalateOutput, escalation_reason: null }).success,
    ).toBe(false);
  });
});
