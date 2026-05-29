import { describe, it, expect } from "vitest";
import {
  ExcelOnlineRateEngine,
  ExcelRateCardSource,
  type ExcelWorkbookTransport,
} from "./excel-rate-card.js";
import { StaticCardRateEngine, type PriceRequest } from "../../agents/src/rate-engine.js";
import type { RateCardLineRow, RateCardRow } from "../../agents/src/rate-card-source.js";

const inScope = (over: Partial<PriceRequest>): PriceRequest => ({
  origin_port_code: "NLRTM",
  destination_port_code: "USNYC",
  mode: "FCL",
  container_type: "40HC",
  container_qty: 1,
  ...over,
});

// A fake read-only workbook holding the Linkport card. Lines are scrambled; sort_order is truth.
const cardMeta: RateCardRow = { version: "2026-06-v1", validity_through: "2026-06-30", lane: "NLRTM-USNYC" };
const lines: RateCardLineRow[] = [
  { kind: "surcharge_per_container", code: "ISPS", container_type: null, amount: 25, sort_order: 3 },
  { kind: "base", code: "BASE_40HC", container_type: "40HC", amount: 2550, sort_order: 2 },
  { kind: "per_shipment_fee", code: "DOC", container_type: null, amount: 65, sort_order: 0 },
  { kind: "surcharge_per_container", code: "BAF", container_type: null, amount: 320, sort_order: 0 },
  { kind: "base", code: "BASE_20GP", container_type: "20GP", amount: 1800, sort_order: 0 },
  { kind: "per_shipment_fee", code: "EXPORT_CUSTOMS", container_type: null, amount: 45, sort_order: 1 },
  { kind: "surcharge_per_container", code: "THC_RTM", container_type: null, amount: 225, sort_order: 1 },
  { kind: "base", code: "BASE_40GP", container_type: "40GP", amount: 2400, sort_order: 1 },
  { kind: "surcharge_per_container", code: "THC_NYC", container_type: null, amount: 290, sort_order: 2 },
];
const fakeWorkbook: ExcelWorkbookTransport = {
  async readCardMeta() { return cardMeta; },
  async readLines() { return lines; },
};

describe("1B.6 — ExcelOnline adapter (hermetic, fake workbook)", () => {
  const excel = new ExcelOnlineRateEngine(new ExcelRateCardSource(fakeWorkbook), "linkport", "NLRTM-USNYC");
  const stat = new StaticCardRateEngine();

  const cases = [
    { ct: "40HC", qty: 2 },
    { ct: "20GP", qty: 1 },
    { ct: "40GP", qty: 3 },
    { ct: "40HC", qty: 1 },
  ] as const;
  for (const c of cases) {
    it(`AC-3 parity: ${c.qty} x ${c.ct} RateQuote identical to StaticCard`, async () => {
      const req = inScope({ container_type: c.ct, container_qty: c.qty });
      expect(await excel.price(req)).toEqual(await stat.price(req));
    });
  }

  it("rejects identically to the StaticCard on an unpriceable request", async () => {
    await expect(excel.price(inScope({ mode: "LCL" }))).rejects.toMatchObject({
      name: "UnpriceableRequestError",
      reason: "out_of_scope_mode",
    });
  });

  it("P-EXCEL-RO: no write method on the adapter, source, or transport", () => {
    const proto = (o: unknown) => o as unknown as Record<string, unknown>;
    for (const name of ["write", "writeCell", "setCell", "update", "save"]) {
      expect(proto(ExcelOnlineRateEngine.prototype)[name]).toBeUndefined();
      expect(proto(ExcelRateCardSource.prototype)[name]).toBeUndefined();
      expect(proto(fakeWorkbook)[name]).toBeUndefined();
    }
  });
});
