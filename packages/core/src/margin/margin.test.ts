import { describe, it, expect } from "vitest";
import { Dec } from "../money/dec.js";
import { fromMajor } from "../money/money.js";
import { money } from "../money/money.js";
import { selectMarginRule, validateMarginRule, lineSell, type MarginRule } from "./margin.js";

const rule = (over: Partial<MarginRule>): MarginRule => ({
  id: "R", match: {}, kind: "MARKUP_ON_BUY", value: Dec.parse("0.1"), applies_to: "ALL", priority: 0, ...over,
});
const q = { mode: "FCL" as const, origin: "CNSHA", destination: "NLRTM", groups: { CN_MAIN: ["CNSHA"] } };

describe("margin rules — selection by specificity, never a silent pick", () => {
  it("a lane-specific rule dominates a mode-wide one, which dominates a global default", () => {
    const r = selectMarginRule([rule({ id: "global" }), rule({ id: "mode", match: { mode: "FCL" } }), rule({ id: "lane", match: { mode: "FCL", origin: { unlocode: "CNSHA" } } })], q);
    expect(r).toMatchObject({ kind: "rule", rule: { id: "lane" } });
  });
  it("incomparable equals tie → priority, else ambiguous (configuration error)", () => {
    const a = rule({ id: "A", match: { origin: { group: "CN_MAIN" } } });
    const b = rule({ id: "B", match: { destination: { country: "NL" } } });
    expect(selectMarginRule([a, b], q)).toEqual({ kind: "ambiguous", rule_ids: ["A", "B"] });
    expect(selectMarginRule([a, { ...b, priority: 1 }], q)).toMatchObject({ kind: "rule", rule: { id: "B" } });
  });
  it("rules for another mode or lane do not apply; nothing applicable → none", () => {
    expect(selectMarginRule([rule({ match: { mode: "LCL" } })], q)).toEqual({ kind: "none" });
  });
  it("validates value ranges and FLAT currency", () => {
    expect(validateMarginRule(rule({ kind: "GROSS_MARGIN", value: Dec.parse("1") }))).toHaveLength(1);
    expect(validateMarginRule(rule({ kind: "FLAT", value: Dec.parse("50") }))).toHaveLength(1);
    expect(validateMarginRule(rule({ kind: "FLAT", value: Dec.parse("50.005"), currency: "EUR" }))).toHaveLength(1);
    expect(selectMarginRule([rule({ kind: "GROSS_MARGIN", value: Dec.parse("0.99") })], q).kind).toBe("invalid");
  });
  it("a FLAT rule cannot carry min_margin (it would always add a second charge — pricing review #4)", () => {
    const flat = rule({ kind: "FLAT", value: Dec.parse("50"), currency: "EUR", min_margin: fromMajor("40", "EUR") });
    expect(validateMarginRule(flat).join()).toMatch(/cannot carry min_margin/);
  });
});

describe("margin formulas — one rounding, on the line's own buy", () => {
  it("MARKUP_ON_BUY: 1,234.56 × 1.075 = 1,327.152 → 1,327.15", () => {
    expect(lineSell(money(123456n, "EUR"), "FREIGHT", rule({ value: Dec.parse("0.075") }))).toEqual(money(132715n, "EUR"));
  });
  it("GROSS_MARGIN: 100.00 / (1 − 0.15) = 117.647… → 117.65 (margin share of sell)", () => {
    expect(lineSell(money(10000n, "EUR"), "LOCAL", rule({ kind: "GROSS_MARGIN", value: Dec.parse("0.15") }))).toEqual(money(11765n, "EUR"));
  });
  it("categories outside applies_to and FLAT rules sell at buy", () => {
    expect(lineSell(money(5000n, "USD"), "DOCUMENT", rule({ applies_to: ["FREIGHT"] }))).toEqual(money(5000n, "USD"));
    expect(lineSell(money(5000n, "USD"), "FREIGHT", rule({ kind: "FLAT", value: Dec.parse("75"), currency: "USD" }))).toEqual(money(5000n, "USD"));
  });
});
