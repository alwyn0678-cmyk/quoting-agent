import { describe, it, expect } from "vitest";
import { SupabaseTableRateEngine } from "./supabase-rate-engine.js";
import {
  assembleRateCard,
  type RateCardSource,
  type RateCardLineRow,
  type RateCardRow,
} from "./rate-card-source.js";
import { StaticCardRateEngine, type PriceRequest } from "./rate-engine.js";
import { RATE_CARD } from "./rate-card.js";

const inScope = (over: Partial<PriceRequest>): PriceRequest => ({
  origin_port_code: "NLRTM",
  destination_port_code: "USNYC",
  mode: "FCL",
  container_type: "40HC",
  container_qty: 1,
  ...over,
});

const cardRow: RateCardRow = { mode: "FCL", version: "2026-06-v1", validity_through: "2026-06-30", lane: "NLRTM-USNYC" };

// Rows in DELIBERATELY scrambled order — sort_order (within kind) is the source of truth, so the
// adapter must reorder them to reproduce the StaticCard's arrays.
const lineRows: RateCardLineRow[] = [
  { kind: "per_shipment_fee", code: "EXPORT_CUSTOMS", container_type: null, amount: 45, sort_order: 1 },
  { kind: "surcharge_per_container", code: "ISPS", container_type: null, amount: 25, sort_order: 3 },
  { kind: "base", code: "BASE_40HC", container_type: "40HC", amount: 2550, sort_order: 2 },
  { kind: "surcharge_per_container", code: "BAF", container_type: null, amount: 320, sort_order: 0 },
  { kind: "per_shipment_fee", code: "DOC", container_type: null, amount: 65, sort_order: 0 },
  { kind: "base", code: "BASE_20GP", container_type: "20GP", amount: 1800, sort_order: 0 },
  { kind: "surcharge_per_container", code: "THC_NYC", container_type: null, amount: 290, sort_order: 2 },
  { kind: "base", code: "BASE_40GP", container_type: "40GP", amount: 2400, sort_order: 1 },
  { kind: "surcharge_per_container", code: "THC_RTM", container_type: null, amount: 225, sort_order: 1 },
];

const fakeSource: RateCardSource = {
  async fetchActiveCard() {
    return { card: cardRow, lines: lineRows };
  },
};

describe("1B.3 — SupabaseTable adapter (hermetic, fake source)", () => {
  const supa = new SupabaseTableRateEngine(fakeSource, "linkport");
  const stat = new StaticCardRateEngine();

  it("assembleRateCard reconstructs the StaticCard from scrambled rows (sort_order applied)", () => {
    expect(assembleRateCard(cardRow, lineRows)).toEqual(RATE_CARD);
  });

  const cases = [
    { ct: "40HC", qty: 2 },
    { ct: "20GP", qty: 1 },
    { ct: "40GP", qty: 3 },
    { ct: "40HC", qty: 1 },
  ] as const;
  for (const c of cases) {
    it(`AC-3 parity: ${c.qty} x ${c.ct} RateQuote identical to StaticCard`, async () => {
      const req = inScope({ container_type: c.ct, container_qty: c.qty });
      expect(await supa.price(req)).toEqual(await stat.price(req));
    });
  }

  it("rejects identically to the StaticCard on an unpriceable request", async () => {
    await expect(supa.price(inScope({ mode: "LCL" }))).rejects.toMatchObject({
      name: "UnpriceableRequestError",
      reason: "out_of_scope_mode",
    });
  });

  it("throws when no active card is found", async () => {
    const empty: RateCardSource = { async fetchActiveCard() { return null; } };
    await expect(new SupabaseTableRateEngine(empty, "t").price(inScope({}))).rejects.toThrow(
      /no active card/,
    );
  });
});

describe("AC-B5/B6 — resolve + price by (mode, lane)", () => {
  const bargeRows = {
    card: { mode: "BARGE", version: "2026-06-v1", validity_through: "2026-06-30", lane: "NLRTM-DEDUI" },
    lines: [
      { kind: "base", code: "BASE_40HC", container_type: "40HC", amount: 420, sort_order: 0 },
      { kind: "surcharge_per_container", code: "LWS", container_type: null, amount: 95, sort_order: 0 },
      { kind: "surcharge_per_container", code: "THC_RTM_BARGE", container_type: null, amount: 95, sort_order: 1 },
      { kind: "surcharge_per_container", code: "THC_DUI", container_type: null, amount: 110, sort_order: 2 },
      { kind: "per_shipment_fee", code: "DOC", container_type: null, amount: 35, sort_order: 0 },
    ],
  } as { card: RateCardRow; lines: RateCardLineRow[] };

  const bargeSource: RateCardSource = {
    async fetchActiveCard(_tenant, mode, lane) {
      return mode === "BARGE" && lane === "NLRTM-DEDUI" ? { card: bargeRows.card, lines: bargeRows.lines } : null;
    },
  };

  const bargeReq: PriceRequest = {
    origin_port_code: "NLRTM",
    destination_port_code: "DEDUI",
    mode: "BARGE",
    container_type: "40HC",
    container_qty: 1,
  };

  it("AC-B5: a (BARGE, NLRTM-DEDUI) card prices to 755 with mode carried through", async () => {
    const eng = new SupabaseTableRateEngine(bargeSource, "linkport");
    const q = await eng.price(bargeReq);
    expect(q.all_in_total).toBe(755);
    expect(q.lane).toBe("NLRTM-DEDUI");
  });

  it("AC-B6: resolution is by request — FCL on the barge source returns null", async () => {
    const eng = new SupabaseTableRateEngine(bargeSource, "linkport");
    expect(await eng.cardFor(bargeReq)).not.toBeNull();
    expect(await eng.cardFor({ ...bargeReq, mode: "FCL" })).toBeNull();
  });
});
