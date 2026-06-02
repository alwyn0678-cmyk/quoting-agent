import { describe, it, expect } from "vitest";
import { parseRateSheet, type RawSheet } from "./parse-rate-sheet.js";

/** Build a well-formed lane sheet (mirrors the workbook layout) from a compact line list. */
function sheet(name: string, lane: string, lines: (string | number | null)[][]): RawSheet {
  return {
    name,
    rows: [
      ["Lane", lane],
      ["Version", "2026-06-v1"],
      ["Valid through", "2026-06-30"],
      [], // blank separator — the parser tolerates it
      ["Kind", "Code", "Container", "Amount (EUR)", "Sort"],
      ...lines,
    ],
  };
}

describe("Q2-AC-Q1 — parseRateSheet maps neutral cells to ParsedCard[]", () => {
  it("parses meta + all three line kinds, mapping a blank container to null", () => {
    const parsed = parseRateSheet([
      sheet("L1", "NLRTM-USNYC", [
        ["base", "BASE_40HC", "40HC", 2550, 2],
        ["surcharge_per_container", "BAF", null, 320, 0],
        ["per_shipment_fee", "DOC", null, 65, 0],
      ]),
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.card).toEqual({
      mode: "FCL",
      lane: "NLRTM-USNYC",
      version: "2026-06-v1",
      validity_through: "2026-06-30",
    });
    expect(parsed[0]?.lines).toEqual([
      { kind: "base", code: "BASE_40HC", container_type: "40HC", amount: 2550, sort_order: 2 },
      { kind: "surcharge_per_container", code: "BAF", container_type: null, amount: 320, sort_order: 0 },
      { kind: "per_shipment_fee", code: "DOC", container_type: null, amount: 65, sort_order: 0 },
    ]);
  });

  it("skips About/README tabs and returns one card per lane tab", () => {
    const parsed = parseRateSheet([
      { name: "About", rows: [["All figures are INVENTED — see docs/ASSUMPTIONS.md."]] },
      sheet("a", "NLRTM-USNYC", [["base", "BASE_20GP", "20GP", 1800, 0]]),
      sheet("b", "DEHAM-USNYC", [["base", "BASE_20GP", "20GP", 1900, 0]]),
    ]);
    expect(parsed.map((p) => p.card.lane)).toEqual(["NLRTM-USNYC", "DEHAM-USNYC"]);
  });
});

describe("Q2-AC-Q4 — parseRateSheet fails fast on a malformed sheet", () => {
  it("throws on an unknown kind", () => {
    expect(() =>
      parseRateSheet([sheet("bad", "NLRTM-USNYC", [["surcharge", "X", null, 10, 0]])]),
    ).toThrow(/unknown kind/i);
  });

  it("throws on a non-numeric amount", () => {
    expect(() =>
      parseRateSheet([sheet("bad", "NLRTM-USNYC", [["base", "BASE_20GP", "20GP", "free", 0]])]),
    ).toThrow(/invalid amount/i);
  });

  it("throws when the meta block is incomplete (no Version)", () => {
    const s: RawSheet = {
      name: "x",
      rows: [
        ["Lane", "NLRTM-USNYC"],
        ["Kind", "Code", "Container", "Amount (EUR)", "Sort"],
        ["base", "BASE_20GP", "20GP", 1800, 0],
      ],
    };
    expect(() => parseRateSheet([s])).toThrow(/missing/i);
  });

  it("throws when there is no header row", () => {
    const s: RawSheet = { name: "x", rows: [["Lane", "NLRTM-USNYC"], ["Version", "2026-06-v1"]] };
    expect(() => parseRateSheet([s])).toThrow(/header/i);
  });

  it("throws on a blank amount (does not coerce '' -> 0)", () => {
    expect(() =>
      parseRateSheet([sheet("bad", "NLRTM-USNYC", [["base", "BASE_20GP", "20GP", null, 0]])]),
    ).toThrow(/invalid amount/i);
  });

  it("throws on a fractional amount (whole EUR only)", () => {
    expect(() =>
      parseRateSheet([sheet("bad", "NLRTM-USNYC", [["base", "BASE_20GP", "20GP", 1800.25, 0]])]),
    ).toThrow(/invalid amount/i);
  });

  it("throws on a base line with no container_type", () => {
    expect(() =>
      parseRateSheet([sheet("bad", "NLRTM-USNYC", [["base", "BASE_20GP", null, 1800, 0]])]),
    ).toThrow(/no container_type/i);
  });

  it("throws on a surcharge line that carries a container_type", () => {
    expect(() =>
      parseRateSheet([sheet("bad", "NLRTM-USNYC", [["surcharge_per_container", "BAF", "40HC", 320, 0]])]),
    ).toThrow(/must not carry a container_type/i);
  });
});
