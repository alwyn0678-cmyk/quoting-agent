import { describe, it, expect } from "vitest";
import Big from "big.js";
import { Dec } from "./dec.js";
import { money, fromMajor, toMajorString, addMoney, sumMoney, chargeAmount, MAX_ABS_MINOR, CURRENCIES } from "./money.js";
import { convert, validateFx, fxFreshness, type FxSnapshot } from "./fx.js";

describe("Dec — exact decimal", () => {
  it("parses canonical decimal strings and rejects everything else", () => {
    expect(Dec.parse("3.10").toString()).toBe("3.1");
    expect(Dec.parse("-0.0425").toString()).toBe("-0.0425");
    expect(Dec.parse("1200").toString()).toBe("1200");
    for (const bad of ["", "1e3", "1.", ".5", "1,5", "NaN", " 1", "0x10", "+1", "1.2.3"]) {
      expect(() => Dec.parse(bad)).toThrow();
    }
  });
  it("is exact where binary floats are not", () => {
    expect(Dec.parse("0.1").add(Dec.parse("0.2")).toString()).toBe("0.3");
    expect(Dec.parse("1.005").round(2, "HALF_AWAY_FROM_ZERO").toString()).toBe("1.01"); // float gives 1.00
    expect(Dec.parse("3.10").mul(Dec.parse("1234.5")).toString()).toBe("3826.95");
  });
  it("rounds HALF_AWAY_FROM_ZERO (symmetric), and supports CEILING/FLOOR/HALF_EVEN", () => {
    expect(Dec.parse("2.345").round(2, "HALF_AWAY_FROM_ZERO").toString()).toBe("2.35");
    expect(Dec.parse("-2.345").round(2, "HALF_AWAY_FROM_ZERO").toString()).toBe("-2.35");
    expect(Dec.parse("2.341").round(2, "CEILING").toString()).toBe("2.35");
    expect(Dec.parse("2.349").round(2, "FLOOR").toString()).toBe("2.34");
    expect(Dec.parse("-2.341").round(2, "CEILING").toString()).toBe("-2.34");
    expect(Dec.parse("-2.341").round(2, "FLOOR").toString()).toBe("-2.35");
    expect(Dec.parse("2.345").round(2, "HALF_EVEN").toString()).toBe("2.34");
    expect(Dec.parse("2.355").round(2, "HALF_EVEN").toString()).toBe("2.36");
  });
  it("divides as one exact rational with a single rounding", () => {
    expect(Dec.divRound(Dec.parse("1"), Dec.parse("3"), 6, "HALF_AWAY_FROM_ZERO").toString()).toBe("0.333333");
    expect(Dec.divRound(Dec.parse("100"), Dec.parse("0.85"), 2, "HALF_AWAY_FROM_ZERO").toString()).toBe("117.65");
    expect(() => Dec.divRound(Dec.parse("1"), Dec.parse("0"), 2, "HALF_AWAY_FROM_ZERO")).toThrow(/zero/);
  });
  it("matches big.js (independent oracle) on 2,000 random mul + round cases", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const randDec = () => {
      const int = Math.floor(rnd() * 100000);
      const frac = Math.floor(rnd() * 10000).toString().padStart(4, "0");
      return `${rnd() < 0.2 ? "-" : ""}${int}.${frac}`;
    };
    for (let i = 0; i < 2000; i++) {
      const a = randDec();
      const b = randDec();
      const ours = Dec.parse(a).mul(Dec.parse(b)).round(2, "HALF_AWAY_FROM_ZERO").toString();
      const oracle = new Big(a).times(b).round(2, Big.roundHalfUp).toString();
      expect(Dec.parse(ours).cmp(Dec.parse(oracle))).toBe(0);
    }
  });
  it("matches big.js on 2,000 random division cases", () => {
    let seed = 11;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < 2000; i++) {
      const a = `${Math.floor(rnd() * 1e6)}.${Math.floor(rnd() * 100)}`;
      const b = `${1 + Math.floor(rnd() * 1e4)}.${Math.floor(rnd() * 1000)}`;
      const ours = Dec.divRound(Dec.parse(a), Dec.parse(b), 4, "HALF_AWAY_FROM_ZERO").toString();
      Big.DP = 60;
      const oracle = new Big(a).div(b).round(4, Big.roundHalfUp).toString();
      expect(Dec.parse(ours).cmp(Dec.parse(oracle))).toBe(0);
    }
  });
});

describe("Money — minor units, ISO-4217 exponents, bounds", () => {
  it("knows exponents (EUR 2, JPY 0)", () => {
    expect(CURRENCIES.EUR.exponent).toBe(2);
    expect(CURRENCIES.JPY.exponent).toBe(0);
  });
  it("converts major-unit strings exactly and refuses unrepresentable precision", () => {
    expect(fromMajor("1234.5", "EUR")).toEqual(money(123450n, "EUR"));
    expect(fromMajor("500", "JPY")).toEqual(money(500n, "JPY"));
    expect(() => fromMajor("1.005", "EUR")).toThrow(/precision/);
    expect(() => fromMajor("1.5", "JPY")).toThrow(/precision/);
  });
  it("renders major units with the currency's exponent", () => {
    expect(toMajorString(money(123450n, "EUR"))).toBe("1234.50");
    expect(toMajorString(money(5n, "USD"))).toBe("0.05");
    expect(toMajorString(money(500n, "JPY"))).toBe("500");
  });
  it("never adds across currencies", () => {
    expect(() => addMoney(money(1n, "EUR"), money(1n, "USD"))).toThrow(/currency/);
    expect(sumMoney([money(150n, "EUR"), money(250n, "EUR")], "EUR")).toEqual(money(400n, "EUR"));
  });
  it("charge amount = rate × qty rounded once (half away from zero) to minor units", () => {
    // $3.10/kg × 1,234.567 kg = 3827.1577 → $3,827.16
    expect(chargeAmount(Dec.parse("3.10"), Dec.parse("1234.567"), "USD")).toEqual(money(382716n, "USD"));
    // €0.0425/kg × 10 kg = 0.425 → €0.43
    expect(chargeAmount(Dec.parse("0.0425"), Dec.parse("10"), "EUR")).toEqual(money(43n, "EUR"));
  });
  it("enforces the absolute bound", () => {
    expect(() => money(MAX_ABS_MINOR + 1n, "EUR")).toThrow(/bound/);
  });
});

describe("FX — exact rational conversion, typed receipts, strict snapshots", () => {
  const fx: FxSnapshot = {
    base: "EUR",
    rates: { EUR: Dec.parse("1"), USD: Dec.parse("1.1234"), ZAR: Dec.parse("18.3930"), JPY: Dec.parse("165.42") },
    source: "ECB euro reference rates",
    as_of: "2026-10-21",
  };
  it("same currency is the identity with no receipt", () => {
    const r = convert(money(1000n, "EUR"), "EUR", fx, "SELL");
    expect(r.money).toEqual(money(1000n, "EUR"));
    expect(r.receipt).toBeNull();
  });
  it("converts via the base with one rounding (USD 1,000.00 → EUR 890.15)", () => {
    // 1000 / 1.1234 = 890.155... → 890.16? exact: 890.1548869... → 890.15
    const r = convert(money(100000n, "USD"), "EUR", fx, "BUY");
    expect(r.money).toEqual(money(89015n, "EUR"));
    expect(r.receipt).toMatchObject({ kind: "BUY", from: "USD", to: "EUR", input_minor: "100000", output_minor: "89015", source: fx.source, as_of: fx.as_of });
  });
  it("cross rates without a base leg (ZAR → USD) and exponent changes (USD → JPY)", () => {
    // 18,393.00 ZAR → EUR 1,000 → USD 1,123.40
    expect(convert(money(1839300n, "ZAR"), "USD", fx, "SELL").money).toEqual(money(112340n, "USD"));
    // USD 11.234 → EUR 10 → JPY 1,654.2 → 1,654 (exponent 0)
    expect(convert(money(1123n, "USD"), "JPY", fx, "SELL").money.minor).toBe(1654n);
  });
  it("a missing rate is a named error, never a silent identity", () => {
    expect(() => convert(money(100n, "USD"), "BRL", fx, "SELL")).toThrow(/fx_missing_rate/);
  });
  it("validates snapshots and freshness (0–7 days, no future)", () => {
    expect(validateFx(fx)).toEqual([]);
    expect(validateFx({ ...fx, rates: { ...fx.rates, USD: Dec.parse("0") } })).toContain("rate for USD must be > 0");
    expect(validateFx({ ...fx, rates: { ...fx.rates, EUR: Dec.parse("1.01") } })).toContain("base rate must be exactly 1");
    expect(fxFreshness(fx, "2026-10-28")).toBe("ok");
    expect(fxFreshness(fx, "2026-10-29")).toBe("stale");
    expect(fxFreshness(fx, "2026-10-20")).toBe("future");
  });
});

describe("Codex review (core 1–4) — money hardening", () => {
  it("#7 public scale arguments must be non-negative safe integers", () => {
    expect(() => Dec.parse("15").round(-1, "HALF_AWAY_FROM_ZERO")).toThrow(/scale/);
    expect(() => Dec.divRound(Dec.ONE, Dec.ONE, -1, "HALF_AWAY_FROM_ZERO")).toThrow(/scale/);
    expect(() => Dec.ONE.toFixedString(-2)).toThrow(/scale/);
  });
  it("#11 public money is non-negative in P1a", () => {
    expect(() => money(-1n, "USD")).toThrow(/negative/);
  });
  it("#8 FX snapshot dates must be real calendar dates", () => {
    const fx = { base: "EUR" as const, rates: { EUR: Dec.ONE }, source: "ECB", as_of: "2026-02-31" };
    expect(validateFx(fx)).toContain("as_of must be a real calendar date (YYYY-MM-DD)");
  });
});
