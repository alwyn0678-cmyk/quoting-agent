import { describe, it, expect } from "vitest";
import { eur, utc, REASON_LABELS, reasonLabel } from "./format.js";

describe("shared display formatting (format.ts)", () => {
  it("eur formats with en-US thousands grouping", () => {
    expect(eur(3520)).toBe("EUR 3,520");
    expect(eur(1234567)).toBe("EUR 1,234,567");
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
