import { describe, it, expect } from "vitest";
import { RATE_CARD, MODE_BASIS, isPriceableMode } from "./rate-card.js";

describe("mode vocabulary", () => {
  it("RATE_CARD is FCL", () => {
    expect(RATE_CARD.mode).toBe("FCL");
  });
  it("container modes map to per_container", () => {
    expect(MODE_BASIS.FCL).toBe("per_container");
    expect(MODE_BASIS.BARGE).toBe("per_container");
    expect(MODE_BASIS.RAIL).toBe("per_container");
  });
  it("air/truck bases are reserved but not yet priceable", () => {
    expect(MODE_BASIS.AIR).toBe("per_chargeable_kg");
    expect(MODE_BASIS.TRUCK).toBe("per_ldm");
    expect(isPriceableMode("AIR")).toBe(false);
    expect(isPriceableMode("TRUCK")).toBe(false);
  });
  it("priceable = mapped AND implemented basis", () => {
    expect(isPriceableMode("FCL")).toBe(true);
    expect(isPriceableMode("BARGE")).toBe(true);
    expect(isPriceableMode("LCL")).toBe(false); // unmapped
    expect(isPriceableMode("UNKNOWN")).toBe(false);
  });
});
