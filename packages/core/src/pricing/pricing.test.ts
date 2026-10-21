import { describe, it, expect } from "vitest";
import { Dec } from "../money/dec.js";
import { money } from "../money/money.js";
import type { FxSnapshot } from "../money/fx.js";
import { loadTariff, type TariffWire, type RateLineWire, type ChargeWire } from "../tariff/model.js";
import { normalizeCargo } from "../request/normalize.js";
import type { Cargo } from "../request/schema.js";
import { price, type PricingContext, type PriceInput } from "./engine.js";
import { toWire } from "./wire.js";
import type { MarginRule } from "../margin/margin.js";

const c = (over: Partial<ChargeWire>): ChargeWire => ({
  id: "OF", code: "OF", description: "Ocean freight", category: "FREIGHT", basis: "PER_CONTAINER", rate: "0", currency: "USD", ...over,
});
const fclLine = (id: string, equipment: string, of: string, baf: string, over: Partial<RateLineWire> = {}): RateLineWire => ({
  id, offer_id: "O1", mode: "FCL", carrier: "Northwind Lines", origin: { unlocode: "CNSHA" }, destination: { unlocode: "NLRTM" },
  equipment, priority: 0, price_kind: "BUY", transit_days: 32, source_ref: `nw-fcl.xlsx!${id}`,
  charges: [
    c({ rate: of }),
    c({ id: "BAF", code: "BAF", description: "Bunker adjustment", category: "SURCHARGE", rate: baf }),
    c({ id: "DOC", code: "DOC", description: "Documentation", category: "DOCUMENT", basis: "PER_BL", rate: "50" }),
  ],
  ...over,
});
const lclLine: RateLineWire = {
  id: "LCL1", offer_id: "L1", mode: "LCL", carrier: "Aurora Consol", origin: { unlocode: "CNSHA" }, destination: { unlocode: "NLRTM" },
  priority: 0, price_kind: "BUY", transit_days: 38, source_ref: "aurora-lcl.xlsx!R3",
  charges: [
    c({ id: "OF", basis: "PER_WM", rate: "85", min: "85" }),
    c({ id: "CFS", code: "CFS", description: "CFS handling", category: "LOCAL", basis: "PER_WM", rate: "25" }),
    c({ id: "DOC", code: "DOC", description: "Documentation", category: "DOCUMENT", basis: "PER_BL", rate: "45" }),
  ],
};
const tariff = (lines: RateLineWire[]): TariffWire => ({
  id: "T1", tenant_id: "linkport", version: "2026-10-v1", source: { kind: "mock-world", ref: "t1.json" },
  valid_from: "2026-10-01", valid_to: "2026-12-31", port_groups: {}, lines,
});
const load = (w: TariffWire) => {
  const r = loadTariff(w);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.tariff;
};
const fx: FxSnapshot = { base: "EUR", rates: { EUR: Dec.ONE, USD: Dec.parse("1.1234") }, source: "ECB", as_of: "2026-10-21" };
const markupFreight: MarginRule = { id: "M-FCL", match: { mode: "FCL" }, kind: "MARKUP_ON_BUY", value: Dec.parse("0.10"), applies_to: ["FREIGHT"], priority: 0 };
const grossAll = (min?: string): MarginRule => ({
  id: "M-LCL", match: { mode: "LCL" }, kind: "GROSS_MARGIN", value: Dec.parse("0.15"), applies_to: "ALL", priority: 0,
  ...(min ? { min_margin: money(BigInt(Math.round(Number(min) * 100)), "EUR") } : {}),
});
const ctx = (rules: MarginRule[], over: Partial<PricingContext> = {}): PricingContext => ({
  as_of: "2026-10-21", quote_currency: "EUR", max_options: 3, quote_validity_days: 14, fx, margin_rules: rules, ...over,
});
const cargo = (over: Partial<Cargo>): Cargo => ({
  containers: [], pieces: [], stated_total_weight: null, stated_total_volume: null, commodity: null,
  dangerous_goods: null, temperature_controlled: null, ...over,
});
const input = (mode: "FCL" | "LCL", cg: Cargo, ready: string | null = null): PriceInput => ({
  mode, origin: "CNSHA", destination: "NLRTM", cargo: normalizeCargo(cg), ready_date: ready,
});

describe("pricing engine — mixed FCL with margin and FX (hand-verified)", () => {
  const t = load(tariff([fclLine("N45", "45G1", "2950", "400"), fclLine("N20", "22G1", "2100", "200")]));
  const req = input("FCL", cargo({ containers: [{ type_raw: "40HC", qty: 2 }, { type_raw: "20GP", qty: 1 }] }));
  const r = price(req, [t], ctx([markupFreight]));
  it("prices one option combining both equipment lines of the same offer", () => {
    expect(r.kind).toBe("priced");
    if (r.kind !== "priced") return;
    expect(r.candidates).toHaveLength(1);
    const o = r.candidates[0]!;
    expect(o.legs[0]!.lines.map((l) => `${l.code}:${l.equipment ?? "-"}:${l.buy?.minor}:${l.sell.minor}`)).toEqual([
      "OF:22G1:210000:231000", "BAF:22G1:20000:20000",
      "OF:45G1:590000:649000", "BAF:45G1:80000:80000",
      "DOC:-:5000:5000",
    ]);
    expect(o.totals.by_currency).toEqual([money(985000n, "USD")]);
    expect(o.totals.quote).toEqual(money(876803n, "EUR")); // USD 9,850.00 → EUR 8,768.03
    expect(o.fx_conversions.map((x) => `${x.kind}:${x.from}->${x.to}:${x.input_minor}->${x.output_minor}`)).toEqual(["SELL:USD->EUR:985000->876803"]);
    expect(o.transit_days).toBe(32);
    expect(o.valid_until).toBe("2026-11-04"); // as-of + 14 days < tariff end
  });
  it("every line carries a reproducible receipt", () => {
    if (r.kind !== "priced") throw new Error("not priced");
    const of = r.candidates[0]!.legs[0]!.lines.find((l) => l.code === "OF" && l.equipment === "45G1")!;
    expect(of.receipt).toMatchObject({ tariff_id: "T1", tariff_version: "2026-10-v1", rate_line_id: "N45", charge_id: "OF", source_ref: "nw-fcl.xlsx!N45", margin_rule_id: "M-FCL", rounding: "HALF_AWAY_FROM_ZERO" });
    expect(of.receipt.content_hash).toBe(t.content_hash);
    expect(of.qty.toString()).toBe("2");
    expect(of.rate.toString()).toBe("2950");
  });
  it("is deterministic: the canonical wire form is byte-identical across runs", () => {
    const again = price(req, [t], ctx([markupFreight]));
    expect(JSON.stringify(toWire(again))).toBe(JSON.stringify(toWire(r)));
  });
});

describe("pricing engine — LCL W/M, gross margin, minimum margin, minimum charge", () => {
  const t = load(tariff([lclLine]));
  const threePallets = cargo({ pieces: [{ qty: 3, length: { value: "120", unit: "cm" }, width: { value: "80", unit: "cm" }, height: { value: "150", unit: "cm" }, weight_each: { value: "400", unit: "kg" }, stackable: false }] });
  it("revenue tons = max(1.2 t, 4.32 m³); gross margin 15% per line", () => {
    const r = price(input("LCL", threePallets), [t], ctx([grossAll()]));
    if (r.kind !== "priced") throw new Error(JSON.stringify(r));
    const o = r.candidates[0]!;
    expect(o.legs[0]!.lines.map((l) => `${l.code}:${l.qty.toString()}:${l.buy?.minor}:${l.sell.minor}`)).toEqual([
      "OF:4.32:36720:43200", "CFS:4.32:10800:12706", "DOC:1:4500:5294",
    ]);
    expect(o.totals.quote).toEqual(money(54477n, "EUR")); // USD 612.00 → EUR 544.77
  });
  it("a minimum-margin shortfall becomes one separate MARGIN_ADJ line in the quote currency", () => {
    const r = price(input("LCL", threePallets), [t], ctx([grossAll("100")]));
    if (r.kind !== "priced") throw new Error(JSON.stringify(r));
    const o = r.candidates[0]!;
    const adj = o.adjustments.find((l) => l.code === "MARGIN_ADJ")!;
    expect(adj.sell).toEqual(money(1829n, "EUR")); // margin EUR 81.71 → top up 18.29
    expect(adj.buy).toBeNull();
    expect(o.totals.quote).toEqual(money(56306n, "EUR"));
    expect(o.fx_conversions.map((x) => x.kind).sort()).toEqual(["BUY", "SELL"]);
  });
  it("applies the carrier minimum charge (0.125 RT × 85 = 10.63 → min 85.00)", () => {
    const tiny = cargo({ pieces: [{ qty: 1, length: { value: "50", unit: "cm" }, width: { value: "50", unit: "cm" }, height: { value: "50", unit: "cm" }, weight_each: { value: "20", unit: "kg" }, stackable: true }] });
    const r = price(input("LCL", tiny), [t], ctx([grossAll()]));
    if (r.kind !== "priced") throw new Error(JSON.stringify(r));
    const of = r.candidates[0]!.legs[0]!.lines.find((l) => l.code === "OF")!;
    expect(of.buy).toEqual(money(8500n, "USD"));
    expect(of.clamped).toBe("min");
  });
});

describe("pricing engine — fail closed, never guess", () => {
  const t = load(tariff([fclLine("N45", "45G1", "2950", "400")]));
  const req = input("FCL", cargo({ containers: [{ type_raw: "40HC", qty: 1 }] }));
  it("a BUY offer without any applicable margin rule is a configuration error (never sold at cost)", () => {
    const r = price(req, [t], ctx([]));
    expect(r.kind === "unpriceable" && r.reason).toBe("tariff_config_error");
  });
  it("needed FX but stale snapshot → fx_invalid; missing rate → fx_missing_rate", () => {
    expect(price(req, [t], ctx([markupFreight], { as_of: "2026-11-15" })).kind).toBe("unpriceable");
    const stale = price(req, [load({ ...tariff([fclLine("N45", "45G1", "2950", "400")]), valid_to: "2026-12-31" })], ctx([markupFreight], { as_of: "2026-11-15" }));
    expect(stale.kind === "unpriceable" && stale.reason).toBe("fx_invalid");
    const missing = price(req, [t], ctx([markupFreight], { fx: { ...fx, rates: { EUR: Dec.ONE } } }));
    expect(missing.kind === "unpriceable" && missing.reason).toBe("fx_missing_rate");
  });
  it("same-currency quotes need no FX snapshot at all", () => {
    const r = price(req, [t], ctx([markupFreight], { quote_currency: "USD", fx: null }));
    expect(r.kind).toBe("priced");
  });
  it("inconsistent shipment-level charges across composed lines reject the offer", () => {
    const t2 = load(tariff([fclLine("N45", "45G1", "2950", "400"), fclLine("N20", "22G1", "2100", "200", { charges: [c({ rate: "2100" }), c({ id: "DOC", code: "DOC", description: "Documentation", category: "DOCUMENT", basis: "PER_BL", rate: "75" })] })]));
    const r = price(input("FCL", cargo({ containers: [{ type_raw: "40HC", qty: 1 }, { type_raw: "20GP", qty: 1 }] })), [t2], ctx([markupFreight]));
    expect(r.kind === "unpriceable" && r.reason).toBe("tariff_config_error");
    expect(r.trace.excluded).toContainEqual({ key: "T1/Northwind Lines/O1", reason: "inconsistent_offer" });
  });
  it("matcher outcomes map to named reasons (lane, ambiguity)", () => {
    expect((p => p.kind === "unpriceable" && p.reason)(price({ ...req, destination: "USNYC" }, [t], ctx([markupFreight])))).toBe("out_of_scope_lane");
    const amb = load(tariff([fclLine("A", "45G1", "1", "1", { destination: { country: "NL" } }), fclLine("B", "45G1", "1", "1", { origin: { country: "CN" } })]));
    expect((p => p.kind === "unpriceable" && p.reason)(price(req, [amb], ctx([markupFreight])))).toBe("ambiguous_request");
  });
});

describe("pricing engine — PCT_OF and options", () => {
  it("percentage charges compute on the rounded referenced amount, same line", () => {
    const l = fclLine("N45", "45G1", "1000", "0", {
      charges: [c({ rate: "1000" }), c({ id: "PSS", code: "PSS", description: "Peak season", category: "SURCHARGE", basis: "PCT_OF", rate: "0.05", percent_of: ["OF"] })],
    });
    const r = price(input("FCL", cargo({ containers: [{ type_raw: "40HC", qty: 3 }] })), [load(tariff([l]))], ctx([markupFreight], { quote_currency: "USD", fx: null }));
    if (r.kind !== "priced") throw new Error(JSON.stringify(r));
    expect(r.candidates[0]!.legs[0]!.lines.find((x) => x.code === "PSS")!.buy).toEqual(money(15000n, "USD"));
  });
  it("orders options by quote total, then carrier, and presents max_options", () => {
    const lines = ["A", "B", "C", "D"].map((k, i) => fclLine(`L${k}`, "45G1", String(3000 - i * 100), "0", { carrier: `Carrier ${k}`, offer_id: `O${k}` }));
    const r = price(input("FCL", cargo({ containers: [{ type_raw: "40HC", qty: 1 }] })), [load(tariff(lines))], ctx([markupFreight], { quote_currency: "USD", fx: null }));
    if (r.kind !== "priced") throw new Error(JSON.stringify(r));
    expect(r.candidates.map((o) => o.carrier)).toEqual(["Carrier D", "Carrier C", "Carrier B", "Carrier A"]);
    expect(r.presented).toHaveLength(3);
    expect(r.presented[0]).toBe(r.candidates[0]!.id);
  });
});

describe("Codex review (engine) — fixes", () => {
  const usdCtx = (rules: MarginRule[], over: Partial<PricingContext> = {}) => ctx(rules, { quote_currency: "USD", fx: null, ...over });
  const lcl = (charges: ChargeWire[]): RateLineWire => ({ ...lclLine, charges });
  it("#1 PER_TON / PER_CBM use exact quantities; only W/M rounds up", () => {
    const t = load(tariff([lcl([c({ id: "T", basis: "PER_TON", rate: "1000" }), c({ id: "V", code: "V", basis: "PER_CBM", rate: "1000" })])]));
    const cg = cargo({ stated_total_weight: { value: "1000.001", unit: "kg" }, stated_total_volume: { value: "1.000001", unit: "cbm" } });
    const r = price(input("LCL", cg), [t], usdCtx([grossAll()].map((x) => ({ ...x, kind: "MARKUP_ON_BUY" as const, value: Dec.parse("0") }))));
    if (r.kind !== "priced") throw new Error(JSON.stringify(r));
    const lines = r.candidates[0]!.legs[0]!.lines;
    expect(lines.find((l) => l.code === "OF")!.buy).toEqual(money(100000n, "USD")); // 1.000001 t × 1000 = 1000.001 → 1000.00
    expect(lines.find((l) => l.code === "V")!.buy).toEqual(money(100000n, "USD"));
    expect(r.candidates[0]!.legs[0]!.quantities.revenue_tons!.toString()).toBe("1.001");
  });
  it("#2 a FLAT fee does not count towards the minimum margin", () => {
    const t = load(tariff([fclLine("N45", "45G1", "100", "0", { charges: [c({ rate: "100", currency: "EUR" })] })]));
    const flat: MarginRule = { id: "F", match: {}, kind: "FLAT", value: Dec.parse("50"), currency: "EUR", applies_to: "ALL", priority: 0, min_margin: money(10000n, "EUR") };
    const r = price(input("FCL", cargo({ containers: [{ type_raw: "40HC", qty: 1 }] })), [t], ctx([flat]));
    if (r.kind !== "priced") throw new Error(JSON.stringify(r));
    const o = r.candidates[0]!;
    expect(o.adjustments.map((a) => `${a.code}:${a.sell.minor}`)).toEqual(["MARGIN_FLAT:5000", "MARGIN_ADJ:10000"]);
    expect(o.totals.quote).toEqual(money(25000n, "EUR"));
  });
  it("#3 amounts beyond the money bound are a named result, never a raw exception", () => {
    const t = load(tariff([fclLine("N45", "45G1", "999999999999", "999999999999")]));
    const r = price(input("FCL", cargo({ containers: [{ type_raw: "40HC", qty: 6 }] })), [t], usdCtx([markupFreight]));
    expect(r.kind === "unpriceable" && r.reason).toBe("pricing_capacity_exceeded");
  });
  it("#4 option ids hash the whole commercial option (quantities change the id)", () => {
    const t = load(tariff([fclLine("N45", "45G1", "2950", "400")]));
    const one = price(input("FCL", cargo({ containers: [{ type_raw: "40HC", qty: 1 }] })), [t], usdCtx([markupFreight]));
    const two = price(input("FCL", cargo({ containers: [{ type_raw: "40HC", qty: 2 }] })), [t], usdCtx([markupFreight]));
    if (one.kind !== "priced" || two.kind !== "priced") throw new Error("not priced");
    expect(one.candidates[0]!.id).toMatch(/^[0-9a-f]{64}$/);
    expect(one.candidates[0]!.id).not.toBe(two.candidates[0]!.id);
  });
  it("#6 an FX overflow is not reported as a missing rate", () => {
    // USD 990,000,000,000.00 sell ÷ 0.01 USD/EUR = EUR 99 trillion → beyond the 10^15 minor bound
    const t = load(tariff([fclLine("N45", "45G1", "900000000000", "0")]));
    const tinyRate: FxSnapshot = { ...fx, rates: { EUR: Dec.ONE, USD: Dec.parse("0.01") } };
    const r = price(input("FCL", cargo({ containers: [{ type_raw: "40HC", qty: 1 }] })), [t], ctx([markupFreight], { fx: tinyRate }));
    expect(r.kind === "unpriceable" && r.reason).toBe("pricing_capacity_exceeded");
  });
  it("#7 the wire form is canonical over object key order", () => {
    expect(JSON.stringify(toWire({ b: 1, a: { d: 2, c: 3 } }))).toBe(JSON.stringify(toWire({ a: { c: 3, d: 2 }, b: 1 })));
  });
  it("#8 an FX failure still reports the selected margin rule and the affected offer", () => {
    const t = load(tariff([fclLine("N45", "45G1", "2950", "400")]));
    const r = price(input("FCL", cargo({ containers: [{ type_raw: "40HC", qty: 1 }] })), [t], ctx([markupFreight], { fx: { ...fx, rates: { EUR: Dec.ONE } } }));
    expect(r.kind).toBe("unpriceable");
    expect(r.trace.margin_rule_ids).toEqual(["M-FCL"]);
    expect(r.trace.excluded).toContainEqual({ key: "T1/Northwind Lines/O1", reason: "fx_missing_rate" });
  });
  it("(Codex #5 rejected, spec amended) LCL accepts piece dimensions plus a stated total weight — the common real-world phrasing", () => {
    const t = load(tariff([lclLine]));
    const cg = cargo({ pieces: [{ qty: 3, length: { value: "120", unit: "cm" }, width: { value: "80", unit: "cm" }, height: { value: "150", unit: "cm" }, weight_each: null, stackable: false }], stated_total_weight: { value: "1200", unit: "kg" } });
    expect(price(input("LCL", cg), [t], ctx([grossAll()])).kind).toBe("priced");
  });
});
