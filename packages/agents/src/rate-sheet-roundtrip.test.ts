import { describe, it, expect, beforeAll } from "vitest";
import { resolve } from "node:path";
import { readRateSheetWorkbook } from "./read-rate-sheet.js";
import { parseRateSheet, type ParsedCard } from "./parse-rate-sheet.js";
import { assembleRateCard } from "./rate-card-source.js";
import { priceQuote, type PriceRequest } from "./rate-engine.js";
import { RATE_CARD } from "./rate-card.js";

const SHEET = resolve(process.cwd(), "rates/linkport-rate-sheet.xlsx");

describe("Q2 round-trip — the committed workbook parses + prices correctly", () => {
  let cards: ParsedCard[];
  beforeAll(async () => {
    cards = parseRateSheet(await readRateSheetWorkbook(SHEET));
  });

  const find = (lane: string) => cards.find((c) => c.card.lane === lane);

  it("contains all four cards (3 FCL lanes + the barge lane)", () => {
    expect(cards.map((c) => c.card.lane).sort()).toEqual([
      "DEHAM-USNYC",
      "NLRTM-DEDUI",
      "NLRTM-USLAX",
      "NLRTM-USNYC",
    ]);
  });

  it("the barge card is mode BARGE and prices 1×40HC at 755 EUR", () => {
    const barge = find("NLRTM-DEDUI");
    expect(barge?.card.mode).toBe("BARGE");
    const q = priceQuote(
      { origin_port_code: "NLRTM", destination_port_code: "DEDUI", mode: "BARGE", container_type: "40HC", container_qty: 1 },
      assembleRateCard(barge!.card, barge!.lines),
    );
    expect(q.all_in_total).toBe(755);
  });

  it("AC-Q2 parity: NLRTM-USNYC assembles to the StaticCard exactly", () => {
    const nyc = find("NLRTM-USNYC");
    expect(nyc).toBeDefined();
    expect(assembleRateCard(nyc!.card, nyc!.lines)).toEqual(RATE_CARD);
  });

  it("AC-Q2 parity: NLRTM-USNYC prices the proven demo totals", () => {
    const card = assembleRateCard(find("NLRTM-USNYC")!.card, find("NLRTM-USNYC")!.lines);
    const req = (over: Partial<PriceRequest>): PriceRequest => ({
      origin_port_code: "NLRTM",
      destination_port_code: "USNYC",
      mode: "FCL",
      container_type: "40HC",
      container_qty: 1,
      ...over,
    });
    expect(priceQuote(req({ container_type: "40HC", container_qty: 2 }), card).all_in_total).toBe(6930);
    expect(priceQuote(req({ container_type: "20GP", container_qty: 1 }), card).all_in_total).toBe(2770);
    expect(priceQuote(req({ container_type: "40HC", container_qty: 1 }), card).all_in_total).toBe(3520);
    expect(priceQuote(req({ container_type: "40GP", container_qty: 3 }), card).all_in_total).toBe(9890);
  });

  it("AC-Q3: NLRTM-USLAX prices a 45HC through the real engine", () => {
    const card = assembleRateCard(find("NLRTM-USLAX")!.card, find("NLRTM-USLAX")!.lines);
    const q = priceQuote(
      {
        origin_port_code: "NLRTM",
        destination_port_code: "USLAX",
        mode: "FCL",
        container_type: "45HC",
        container_qty: 1,
      },
      card,
    );
    expect(q.all_in_total).toBe(4620); // 3250 + 1260 surcharges + 110 fees
  });
});
