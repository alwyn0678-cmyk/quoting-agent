import { describe, it, expect } from "vitest";
import { eur, minorMoney, utc, REASON_LABELS, reasonLabel } from "./format.js";
import { ESCALATION_REASONS } from "../../../../packages/core/src/reasons.js";

describe("shared display formatting (format.ts)", () => {
  it("eur formats with en-US thousands grouping", () => {
    expect(eur(3520)).toBe("EUR 3,520");
    expect(eur(1234567)).toBe("EUR 1,234,567");
  });

  it("minorMoney renders v2 minor-unit amounts exactly per currency exponent", () => {
    expect(minorMoney("2110950", "USD")).toBe("USD 21,109.50");
    expect(minorMoney("5", "EUR")).toBe("EUR 0.05");
    expect(minorMoney("0", "GBP")).toBe("GBP 0.00");
    expect(minorMoney("1234567", "JPY")).toBe("JPY 1,234,567");
    expect(minorMoney("100000000000000099", "EUR")).toBe("EUR 1,000,000,000,000,000.99"); // beyond float precision
  });

  it("minorMoney rejects malformed amounts and currencies outside the allowlist", () => {
    expect(minorMoney("12.50", "USD")).toBeNull();
    expect(minorMoney("-5", "USD")).toBeNull();
    expect(minorMoney("100", "XXX")).toBeNull();
    expect(minorMoney("100", "toString")).toBeNull();
  });

  it("every escalation reason in the taxonomy has a dashboard label", () => {
    const missing = ESCALATION_REASONS.filter((r) => !Object.hasOwn(REASON_LABELS, r));
    expect(missing).toEqual([]);
  });

  it("utc renders the instant in UTC with an explicit suffix", () => {
    expect(utc("2026-06-01T16:00:01Z")).toBe("01/06/2026, 16:00:01 UTC");
  });

  it("reasonLabel maps known codes to the shared labels (inbox/archive render identically)", () => {
    expect(reasonLabel("out_of_scope_mode")).toBe("Transport mode not priced yet");
    expect(reasonLabel("guard_violation")).toBe(REASON_LABELS["guard_violation"]);
  });

  it("reasonLabel falls back to the humanized code for unknown reasons", () => {
    expect(reasonLabel("brand_new_reason")).toBe("brand new reason");
  });
});
