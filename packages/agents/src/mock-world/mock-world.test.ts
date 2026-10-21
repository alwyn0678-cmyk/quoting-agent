import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildMockWorld } from "./build.js";
import { MOCK_WORLD_DIR, readMockWorld, tenantRuntime, mockWorldSource } from "./load.js";
import { price } from "../../../core/src/pricing/engine.js";
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
