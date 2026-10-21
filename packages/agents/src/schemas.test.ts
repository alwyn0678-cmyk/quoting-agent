import { describe, it, expect } from "vitest";
import { RateQuoteSchema, type RateQuote } from "./schemas.js";

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
