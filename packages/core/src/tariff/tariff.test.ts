import { describe, it, expect } from "vitest";
import { loadTariff, type TariffWire, type RateLineWire, type ChargeWire } from "./model.js";
import { matchOffers, type MatchQuery } from "./matcher.js";

const charge = (over: Partial<ChargeWire> = {}): ChargeWire => ({
  id: "OF", code: "OF", description: "Ocean freight", category: "FREIGHT", basis: "PER_CONTAINER",
  rate: "1000", currency: "USD", ...over,
});
const line = (over: Partial<RateLineWire> = {}): RateLineWire => ({
  id: "L1", offer_id: "O1", mode: "FCL", carrier: "Northwind Lines",
  origin: { unlocode: "CNSHA" }, destination: { unlocode: "NLRTM" }, equipment: "45G1",
  priority: 0, price_kind: "BUY", charges: [charge()], source_ref: "sheet!R1", ...over,
});
const tariff = (lines: RateLineWire[], over: Partial<TariffWire> = {}): TariffWire => ({
  id: "T1", tenant_id: "linkport", version: "2026-10-v1", source: { kind: "mock-world", ref: "t1.json" },
  valid_from: "2026-10-01", valid_to: "2026-12-31", port_groups: { CN_MAIN: ["CNSHA", "CNNGB"] }, lines, ...over,
});
const q = (over: Partial<MatchQuery> = {}): MatchQuery => ({
  mode: "FCL", origin: "CNSHA", destination: "NLRTM", equipment: ["45G1"], as_of: "2026-10-21", pricing_date: "2026-10-21", ...over,
});
const ok = (w: TariffWire) => {
  const r = loadTariff(w);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.tariff;
};

describe("tariff validation — fail closed with named errors", () => {
  it("accepts a valid tariff and computes a stable content hash", () => {
    const a = ok(tariff([line()]));
    const b = ok(tariff([line()]));
    expect(a.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.content_hash).toBe(b.content_hash);
    expect(ok(tariff([line({ priority: 1 })])).content_hash).not.toBe(a.content_hash);
  });
  it("the hash ignores line order (canonical)", () => {
    const l2 = line({ id: "L2", equipment: "22G1" });
    expect(ok(tariff([line(), l2])).content_hash).toBe(ok(tariff([l2, line()])).content_hash);
  });
  const errs = (w: TariffWire) => {
    const r = loadTariff(w);
    return r.ok ? [] : r.errors;
  };
  it("rejects duplicate line ids and duplicate charge ids within a line", () => {
    expect(errs(tariff([line(), line()])).join()).toMatch(/duplicate rate line id 'L1'/);
    expect(errs(tariff([line({ charges: [charge(), charge()] })])).join()).toMatch(/duplicate charge id 'OF'/);
  });
  it("rejects PCT_OF cycles, dangling references and cross-currency bases", () => {
    const cyc = [charge({ id: "A", basis: "PCT_OF", rate: "0.1", percent_of: ["B"] }), charge({ id: "B", basis: "PCT_OF", rate: "0.1", percent_of: ["A"] })];
    expect(errs(tariff([line({ charges: cyc })])).join()).toMatch(/cycle/);
    expect(errs(tariff([line({ charges: [charge({ id: "P", basis: "PCT_OF", rate: "0.1", percent_of: ["X"] })] })])).join()).toMatch(/unknown charge 'X'/);
    const cross = [charge(), charge({ id: "P", basis: "PCT_OF", rate: "0.1", percent_of: ["OF"], currency: "EUR" })];
    expect(errs(tariff([line({ charges: cross })])).join()).toMatch(/same currency/);
    const dup = [charge(), charge({ id: "P", basis: "PCT_OF", rate: "0.1", percent_of: ["OF", "OF"] })];
    expect(errs(tariff([line({ charges: dup })])).join()).toMatch(/duplicate percent_of/); // pricing review #5
  });
  it("rejects clamps that the currency cannot represent, and min > max", () => {
    expect(errs(tariff([line({ charges: [charge({ min: "10.005" })] })])).join()).toMatch(/precision/);
    expect(errs(tariff([line({ charges: [charge({ min: "50", max: "10" })] })])).join()).toMatch(/min > max/);
  });
  it("enforces mode/basis/equipment consistency", () => {
    expect(errs(tariff([line({ equipment: undefined })])).join()).toMatch(/FCL line .* equipment/);
    expect(errs(tariff([line({ mode: "LCL", charges: [charge({ basis: "PER_CONTAINER" })] , equipment: undefined })])).join()).toMatch(/PER_CONTAINER .* not valid for LCL/);
  });
  it("one price_kind per offer", () => {
    expect(errs(tariff([line(), line({ id: "L2", equipment: "22G1", price_kind: "SELL" })])).join()).toMatch(/offer 'O1' mixes BUY and SELL/);
  });
  it("rejects validity windows that end before they start", () => {
    expect(errs(tariff([line()], { valid_from: "2026-12-31", valid_to: "2026-01-01" })).join()).toMatch(/valid_from after valid_to/);
  });
});

describe("matching — specificity partial order, priority, validity, mixed equipment", () => {
  it("an exact port pair dominates a group or country match", () => {
    const t = ok(tariff([
      line({ id: "exact" }),
      line({ id: "group", origin: { group: "CN_MAIN" } }),
      line({ id: "country", origin: { country: "CN" } }),
    ]));
    const r = matchOffers([t], q());
    expect(r.kind).toBe("matched");
    if (r.kind !== "matched") return;
    expect(r.offers).toHaveLength(1);
    expect(r.offers[0]!.lines.map((l) => l.line.id)).toEqual(["exact"]);
  });
  it("incomparable matches (exact origin vs exact destination) tie → priority decides, else ambiguous", () => {
    const a = line({ id: "A", destination: { country: "NL" } });
    const b = line({ id: "B", origin: { country: "CN" } });
    expect(matchOffers([ok(tariff([a, b]))], q()).kind).toBe("ambiguous");
    const r = matchOffers([ok(tariff([a, { ...b, priority: 5 }]))], q());
    expect(r.kind === "matched" && r.offers[0]!.lines[0]!.line.id).toBe("B");
  });
  it("different carriers are different offers (options), not ambiguity", () => {
    const r = matchOffers([ok(tariff([line(), line({ id: "L2", carrier: "Aurora Shipping", offer_id: "O9" })]))], q());
    expect(r.kind === "matched" && r.offers.length).toBe(2);
  });
  it("mixed equipment composes one offer only when every type resolves within the same offer", () => {
    const t = ok(tariff([line(), line({ id: "L20", equipment: "22G1" }), line({ id: "X40", offer_id: "O2", carrier: "Aurora Shipping" })]));
    const r = matchOffers([t], q({ equipment: ["22G1", "45G1"] }));
    expect(r.kind).toBe("matched");
    if (r.kind !== "matched") return;
    expect(r.offers).toHaveLength(1); // Aurora lacks 22G1 → excluded, recorded
    expect(r.offers[0]!.lines.map((l) => l.equipment).sort()).toEqual(["22G1", "45G1"]);
    expect(r.trace.excluded).toContainEqual({ key: "T1/Aurora Shipping/O2", reason: "incomplete_equipment" });
  });
  it("validity must cover both as-of and the pricing date (inclusive end)", () => {
    const t = ok(tariff([line({ valid_to: "2026-11-15" })]));
    expect(matchOffers([t], q({ pricing_date: "2026-11-15" })).kind).toBe("matched");
    const r = matchOffers([t], q({ pricing_date: "2026-11-16" }));
    expect(r.kind).toBe("none");
    if (r.kind === "none") expect(r.reason).toBe("rate_expired");
  });
  it("no lane at all → out_of_scope_lane; lane but no line for the requested equipment → out_of_scope_container", () => {
    const t = ok(tariff([line()]));
    const r1 = matchOffers([t], q({ destination: "USNYC" }));
    expect(r1.kind === "none" && r1.reason).toBe("out_of_scope_lane");
    const r2 = matchOffers([t], q({ equipment: ["22G1"] }));
    expect(r2.kind === "none" && r2.reason).toBe("out_of_scope_container");
  });
  it("mixed equipment where one type's only rate has expired → rate_expired (not 'container')", () => {
    const t = ok(tariff([line(), line({ id: "L20", equipment: "22G1", valid_to: "2026-10-15" })]));
    const r = matchOffers([t], q({ equipment: ["22G1", "45G1"] }));
    expect(r.kind === "none" && r.reason).toBe("rate_expired");
  });
  it("LCL lines match without equipment", () => {
    const lcl = line({ id: "LCL1", mode: "LCL", equipment: undefined, charges: [charge({ basis: "PER_WM", rate: "85" })] });
    const r = matchOffers([ok(tariff([lcl]))], q({ mode: "LCL", equipment: [] }));
    expect(r.kind === "matched" && r.offers[0]!.lines[0]!.line.id).toBe("LCL1");
  });
});

describe("tariff validation — scope rules the engine relies on", () => {
  const errs = (w: TariffWire) => {
    const r = loadTariff(w);
    return r.ok ? [] : r.errors;
  };
  it("PCT_OF may not reference a shipment-level charge (it would double count per equipment line)", () => {
    const l = line({ charges: [charge(), charge({ id: "DOC", basis: "PER_BL", category: "DOCUMENT" }), charge({ id: "P", basis: "PCT_OF", rate: "0.1", percent_of: ["DOC"] })] });
    expect(errs(tariff([l])).join()).toMatch(/shipment-level/);
  });
  it("line validity must sit inside the tariff's validity", () => {
    expect(errs(tariff([line({ valid_to: "2027-01-31" })])).join()).toMatch(/outside the tariff/);
  });
});

describe("Codex review (core 1–4) — tariff/snapshot hardening", () => {
  it("#3 identifiers are unique across the whole snapshot (tariff ids, rate-line ids)", async () => {
    const { loadSnapshot } = await import("./model.js");
    const a = tariff([line()]);
    expect(loadSnapshot([a, { ...a }]).ok).toBe(false);
    expect(loadSnapshot([a, tariff([line()], { id: "T2" })]).ok).toBe(false); // line L1 twice
    expect(loadSnapshot([a, tariff([line({ id: "L9" })], { id: "T2" })]).ok).toBe(true);
  });
  it("#5 the content hash is canonical over charge order, group member order and decimal spelling", () => {
    const two = [charge(), charge({ id: "DOC", code: "DOC", basis: "PER_BL", category: "DOCUMENT", rate: "50" })];
    const h1 = ok(tariff([line({ charges: two })])).content_hash;
    expect(ok(tariff([line({ charges: [...two].reverse() })])).content_hash).toBe(h1);
    expect(ok(tariff([line({ charges: [charge({ rate: "1000.00" }), two[1]!] })])).content_hash).toBe(h1);
    expect(ok(tariff([line()], { port_groups: { CN_MAIN: ["CNNGB", "CNSHA"] } })).content_hash).toBe(ok(tariff([line()])).content_hash);
  });
  it("#6 bounded decimal strings (≤ 16 chars) and ≤ 20 carriers per snapshot", async () => {
    const { loadSnapshot } = await import("./model.js");
    const r = loadTariff(tariff([line({ charges: [charge({ rate: "999999999999.99999999" })] })]));
    expect(r.ok).toBe(false);
    const many = Array.from({ length: 21 }, (_, i) => line({ id: `L${i}`, carrier: `Carrier ${i}`, offer_id: `O${i}` }));
    expect(loadSnapshot([tariff(many)]).ok).toBe(false);
  });
  it("#8 tariff dates must be real calendar dates", () => {
    expect(loadTariff(tariff([line()], { valid_to: "2026-02-31" })).ok).toBe(false);
  });
  it("#9 the trace records dominated and lower-priority lines", () => {
    const t = ok(tariff([line({ id: "exact" }), line({ id: "country", origin: { country: "CN" } }), line({ id: "low", origin: { country: "CN" }, destination: { country: "NL" }, priority: -1 })]));
    const r = matchOffers([t], q());
    expect(r.trace.excluded).toContainEqual({ key: "country", reason: "dominated" });
  });
});
