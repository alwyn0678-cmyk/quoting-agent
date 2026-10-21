import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildMockWorld } from "./build.js";
import { MOCK_WORLD_DIR, readMockWorld, tenantRuntime, mockWorldSource } from "./load.js";
import { price } from "../../../core/src/pricing/engine.js";
import { checkInvariants } from "../../../core/src/guard/guard.js";
import { normalizeCargo } from "../../../core/src/request/normalize.js";
import type { Cargo } from "../../../core/src/request/schema.js";

const cargo = (over: Partial<Cargo>): Cargo => ({
  containers: [], pieces: [], stated_total_weight: null, stated_total_volume: null, commodity: null,
  dangerous_goods: null, temperature_controlled: null, ...over,
});

describe("mock world — deterministic, valid, priceable", () => {
  it("regenerating reproduces the committed files byte for byte", () => {
    const w = buildMockWorld();
    const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
    expect(readFileSync(resolve(MOCK_WORLD_DIR, "tenants.json"), "utf8")).toBe(json(w.tenants));
    expect(readFileSync(resolve(MOCK_WORLD_DIR, "fx.json"), "utf8")).toBe(json(w.fx));
    for (const [id, t] of Object.entries(w.tariffs)) {
      expect(readFileSync(resolve(MOCK_WORLD_DIR, "tariffs", `${id}.json`), "utf8")).toBe(json(t));
    }
  });
  const world = readMockWorld();
  const source = mockWorldSource(world);
  it("has six tenants and every tariff snapshot validates", async () => {
    expect(world.tenants.map((t) => t.id).sort()).toEqual(["elbkai", "kopjeveld", "linkport", "lumenstrait", "prairiegate", "ventoleste"]);
    for (const t of world.tenants) expect((await source.snapshot(t.id)).length).toBe(1);
  });
  it("every tenant prices every FCL lane (mixed equipment) and its LCL lane in its own currency", async () => {
    for (const t of world.tenants) {
      const rt = tenantRuntime(world, t.id);
      const tariffs = await source.snapshot(t.id);
      const lines = tariffs.flatMap((x) => x.lines);
      const lanes = [...new Set(lines.map((l) => `${l.mode}|${"unlocode" in l.origin ? l.origin.unlocode : ""}|${"unlocode" in l.destination ? l.destination.unlocode : ""}`))];
      for (const lane of lanes) {
        const [mode, origin, destination] = lane.split("|") as ["FCL" | "LCL", string, string];
        const cg = mode === "FCL"
          ? cargo({ containers: [{ type_raw: "40HC", qty: 2 }, { type_raw: "20GP", qty: 1 }] })
          : cargo({ stated_total_weight: { value: "1800", unit: "kg" }, stated_total_volume: { value: "6.2", unit: "cbm" } });
        const r = price({ mode, origin, destination, cargo: normalizeCargo(cg), ready_date: null }, tariffs, rt.context("2026-10-21"));
        expect(r.kind, `${t.id} ${lane}: ${r.kind === "unpriceable" ? r.reason + " " + r.detail : ""}`).toBe("priced");
        if (r.kind === "priced") expect(r.candidates[0]!.totals.quote.currency).toBe(t.quote_currency);
        // independent invariants hold on every real result (sums, FX, provenance, margins, validity)
        expect(checkInvariants(r, tariffs, rt.context("2026-10-21")), `${t.id} ${lane}`).toEqual([]);
      }
    }
  });
  it("contains a realistic expired-rate case: after 2026-11-15 one carrier drops out of the first lane", async () => {
    const tariffs = await source.snapshot("linkport");
    const rt = tenantRuntime(world, "linkport");
    const req = { mode: "FCL" as const, origin: "CNSHA", destination: "NLRTM", cargo: normalizeCargo(cargo({ containers: [{ type_raw: "40HC", qty: 1 }] })) };
    const before = price({ ...req, ready_date: null }, tariffs, rt.context("2026-10-21"));
    const after = price({ ...req, ready_date: "2026-11-20" }, tariffs, rt.context("2026-10-21"));
    if (before.kind !== "priced" || after.kind !== "priced") throw new Error("expected priced");
    expect(after.candidates.length).toBe(before.candidates.length - 1);
  });
});

describe("guard invariants catch a deterministic-but-wrong result (architecture review #5)", () => {
  const world = readMockWorld();
  const rt = tenantRuntime(world, "linkport");
  const ctx = rt.context("2026-10-21");
  const priced = async () => {
    const tariffs = await mockWorldSource(world).snapshot("linkport");
    const r = price({ mode: "FCL", origin: "CNSHA", destination: "NLRTM", cargo: normalizeCargo(cargo({ containers: [{ type_raw: "40HC", qty: 2 }] })), ready_date: null }, tariffs, ctx);
    if (r.kind !== "priced") throw new Error("expected priced");
    return { r, tariffs };
  };
  const mutate = async (f: (o: ReturnType<typeof structuredClone<Awaited<ReturnType<typeof priced>>["r"]>>) => void) => {
    const { r, tariffs } = await priced();
    const copy = structuredClone(r);
    f(copy);
    return checkInvariants(copy, tariffs, ctx);
  };

  it("a line amount changed without its subtotal", async () => {
    expect(await mutate((r) => { const l = r.candidates[0]!.legs[0]!.lines[0]!; l.sell = { ...l.sell, minor: l.sell.minor + 1n }; })).toContain("subtotal_mismatch");
  });
  it("a quote total that is not subtotal + converted subtotals", async () => {
    expect(await mutate((r) => { const t = r.candidates[0]!.totals; t.quote = { ...t.quote, minor: t.quote.minor + 100n }; })).toContain("fx_total_mismatch");
  });
  it("a receipt that points at a tariff not in this snapshot", async () => {
    expect(await mutate((r) => { r.candidates[0]!.legs[0]!.lines[0]!.receipt.content_hash = "0".repeat(64); })).toContain("unknown_tariff_receipt");
  });
  it("a line sold below its buy", async () => {
    expect(
      await mutate((r) => {
        const l = r.candidates[0]!.legs[0]!.lines.find((x) => x.buy)!;
        l.buy = { ...l.buy!, minor: l.sell.minor + 1n };
      }),
    ).toContain("sell_below_buy");
  });
  it("a presented option that is not a candidate, or validity before as-of", async () => {
    expect(await mutate((r) => { r.presented = ["nope"]; })).toContain("presented_not_candidate");
    expect(await mutate((r) => { r.candidates[0]!.valid_until = "2026-01-01"; })).toContain("expired_validity");
  });
});
