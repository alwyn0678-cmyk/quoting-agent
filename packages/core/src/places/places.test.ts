import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isUnlocode, isIata, countryOf, laneEndScore, laneEndMatches } from "./places.js";
import { normalizeEquipment, EQUIPMENT, teuOf } from "./equipment.js";
import { checkPlace, namedPorts } from "./resolve.js";

describe("places — codes and lane-end matching", () => {
  it("validates UN/LOCODE (digits 2–9 only) and IATA codes", () => {
    expect(isUnlocode("NLRTM")).toBe(true);
    expect(isUnlocode("USNYC")).toBe(true);
    expect(isUnlocode("DE2AB")).toBe(true);
    expect(isUnlocode("NL1TM")).toBe(false);
    expect(isUnlocode("nlrtm")).toBe(false);
    expect(isIata("AMS")).toBe(true);
    expect(isIata("AMSX")).toBe(false);
  });
  it("derives the country from a UN/LOCODE", () => {
    expect(countryOf("NLRTM")).toBe("NL");
  });
  it("scores lane ends exact(3) > group(2) > country(1) > any(0); non-matches are null", () => {
    const groups = { NL_PORTS: ["NLRTM", "NLAMS"] };
    expect(laneEndScore({ unlocode: "NLRTM" }, "NLRTM", groups)).toBe(3);
    expect(laneEndScore({ group: "NL_PORTS" }, "NLRTM", groups)).toBe(2);
    expect(laneEndScore({ country: "NL" }, "NLRTM", groups)).toBe(1);
    expect(laneEndScore({ any: true }, "NLRTM", groups)).toBe(0);
    expect(laneEndScore({ unlocode: "BEANR" }, "NLRTM", groups)).toBeNull();
    expect(laneEndScore({ group: "NL_PORTS" }, "BEANR", groups)).toBeNull();
    expect(laneEndMatches({ group: "MISSING" }, "NLRTM", groups)).toBe(false);
  });
});

describe("equipment — ISO 6346 size/type with colloquial aliases", () => {
  it("maps what customers write to ISO codes", () => {
    for (const [raw, iso] of [
      ["40HC", "45G1"], ["40' HC", "45G1"], ["40hq", "45G1"], ["40 high cube", "45G1"],
      ["20GP", "22G1"], ["20DV", "22G1"], ["20ft", "22G1"], ["40GP", "42G1"], ["40'", "42G1"],
      ["45HC", "L5G1"], ["40RF", "45R1"], ["22G1", "22G1"],
    ] as const) {
      expect(normalizeEquipment(raw)).toBe(iso);
    }
    expect(normalizeEquipment("container")).toBeNull();
    expect(normalizeEquipment("40")).toBe("42G1");
  });
  it("knows TEU and equipment class", () => {
    expect(teuOf("22G1")).toBe(1);
    expect(teuOf("45G1")).toBe(2);
    expect(EQUIPMENT["45R1"].kind).toBe("reefer");
  });
});

describe("architecture — packages/core is pure (no SDKs, no I/O layers)", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) files.push(p);
    }
  };
  walk(root);
  it("imports only relative core modules, zod and node:crypto", () => {
    const allowed = (spec: string) => spec.startsWith("./") || spec.startsWith("../") || spec === "zod" || spec === "node:crypto";
    const violations: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/from\s+["']([^"']+)["']/g)) {
        const spec = m[1]!;
        const escapesCore = spec.startsWith("../") && !join(dirname(f), spec).startsWith(root);
        if (!allowed(spec) || escapesCore) violations.push(`${f.slice(root.length)} → ${spec}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("place cross-check (architecture review #6)", () => {
  it("agrees when the text names the coded port, in any of the indexed languages", () => {
    expect(checkPlace("Rotterdam", "NLRTM")).toBe("consistent");
    expect(checkPlace("Roterdã", "NLRTM")).toBe("consistent");
    expect(checkPlace("上海港", "CNSHA")).toBe("consistent");
    expect(checkPlace("Port of Shanghai, China", "CNSHA")).toBe("consistent");
    expect(checkPlace("Rotterdam or Antwerp", "BEANR")).toBe("consistent");
  });
  it("contradicts a well-formed but wrong code", () => {
    expect(checkPlace("Antwerp", "NLRTM")).toBe("contradicts");
    expect(checkPlace("Hamburgo", "NLRTM")).toBe("contradicts");
  });
  it("defers to the model for places it cannot check", () => {
    expect(checkPlace("Yantian", "CNYTN")).toBe("unrecognised"); // code not in the index
    expect(checkPlace("our warehouse", "NLRTM")).toBe("unrecognised"); // no known name in the text
  });
  it("does not match a name inside another word", () => {
    expect(namedPorts("Antwerpse Haven")).toEqual([]);
  });
});
