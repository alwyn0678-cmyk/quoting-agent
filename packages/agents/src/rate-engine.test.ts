import { describe, it, expect } from "vitest";
import {
  priceQuote,
  StaticCardRateEngine,
  UnpriceableRequestError,
  type PriceRequest,
} from "./rate-engine.js";
import type { RateCard } from "./rate-card.js";

const inScope = (over: Partial<PriceRequest>): PriceRequest => ({
  origin_port_code: "NLRTM",
  destination_port_code: "USNYC",
  mode: "FCL",
  container_type: "40HC",
  container_qty: 1,
  ...over,
});

describe("T4 — rate engine: deterministic, exact", () => {
  const cases: { ct: "20GP" | "40GP" | "40HC"; qty: number; total: number; base: number }[] = [
    { ct: "40HC", qty: 2, total: 6930, base: 2550 },
    { ct: "20GP", qty: 1, total: 2770, base: 1800 },
    { ct: "40GP", qty: 3, total: 9890, base: 2400 },
    { ct: "40HC", qty: 1, total: 3520, base: 2550 },
  ];

  for (const c of cases) {
    it(`${c.qty} x ${c.ct} all-in = ${c.total} EUR`, () => {
      const q = priceQuote(inScope({ container_type: c.ct, container_qty: c.qty }));
      expect(q.all_in_total).toBe(c.total);
      expect(q.base_per_container).toBe(c.base);
      expect(q.container_type).toBe(c.ct);
      expect(q.container_qty).toBe(c.qty);
      expect(q.currency).toBe("EUR");
      expect(q.lane).toBe("NLRTM-USNYC");
      expect(q.validity_through).toBe("2026-06-30");
      // breakdown sums back to the headline total
      const surch = q.surcharges.reduce((s, x) => s + x.amount_per_container, 0);
      const fees = q.per_shipment_fees.reduce((s, x) => s + x.amount, 0);
      expect(c.qty * (q.base_per_container + surch) + fees).toBe(q.all_in_total);
    });
  }

  it("is reproducible (same input -> identical output)", () => {
    const a = priceQuote(inScope({ container_type: "40HC", container_qty: 2 }));
    const b = priceQuote(inScope({ container_type: "40HC", container_qty: 2 }));
    expect(a).toEqual(b);
  });
});

describe("T5 — unknown key is never fabricated", () => {
  it("throws on an out-of-scope lane (Rotterdam -> Los Angeles)", () => {
    const call = () => priceQuote(inScope({ destination_port_code: "USLAX" }));
    expect(call).toThrow(UnpriceableRequestError);
    try {
      call();
    } catch (e) {
      expect((e as UnpriceableRequestError).reason).toBe("out_of_scope_lane");
    }
  });

  it("throws on an out-of-scope mode (LCL)", () => {
    const call = () => priceQuote(inScope({ mode: "LCL" }));
    expect(call).toThrow(UnpriceableRequestError);
    try {
      call();
    } catch (e) {
      expect((e as UnpriceableRequestError).reason).toBe("out_of_scope_mode");
    }
  });

  it("throws on an unknown/absent container type", () => {
    expect(() => priceQuote(inScope({ container_type: "UNKNOWN" }))).toThrow(UnpriceableRequestError);
    expect(() => priceQuote(inScope({ container_type: null }))).toThrow(UnpriceableRequestError);
  });

  it("throws on an invalid quantity", () => {
    expect(() => priceQuote(inScope({ container_qty: 0 }))).toThrow(UnpriceableRequestError);
    expect(() => priceQuote(inScope({ container_qty: null }))).toThrow(UnpriceableRequestError);
  });
});

describe("P-1A.2 — StaticCard adapter is behaviour-identical to priceQuote()", () => {
  const cases: Partial<PriceRequest>[] = [
    { container_type: "40HC", container_qty: 2 },
    { container_type: "20GP", container_qty: 1 },
    { container_type: "40GP", container_qty: 3 },
    { container_type: "40HC", container_qty: 1 },
  ];

  for (const over of cases) {
    it(`adapter price() === priceQuote() for ${over.container_qty} x ${over.container_type}`, async () => {
      const req = inScope(over);
      const viaAdapter = await new StaticCardRateEngine().price(req);
      expect(viaAdapter).toEqual(priceQuote(req));
    });
  }

  const unpriceable: { label: string; over: Partial<PriceRequest>; reason: string }[] = [
    { label: "out-of-scope mode (LCL)", over: { mode: "LCL" }, reason: "out_of_scope_mode" },
    { label: "out-of-scope lane", over: { destination_port_code: "USLAX" }, reason: "out_of_scope_lane" },
    { label: "unknown container", over: { container_type: "UNKNOWN" }, reason: "out_of_scope_container" },
    { label: "invalid quantity", over: { container_qty: 0 }, reason: "invalid_quantity" },
  ];
  for (const u of unpriceable) {
    it(`rejects identically to priceQuote() on ${u.label}`, async () => {
      const req = inScope(u.over);
      let sync: UnpriceableRequestError | undefined;
      try {
        priceQuote(req);
      } catch (e) {
        sync = e as UnpriceableRequestError;
      }
      expect(sync?.reason).toBe(u.reason); // priceQuote() itself threw the expected reason
      await expect(new StaticCardRateEngine().price(req)).rejects.toMatchObject({
        name: "UnpriceableRequestError",
        reason: u.reason,
        message: sync?.message, // same reason AND same message — true error parity
      });
    });
  }
});

describe("Q2-AC-Q0 — engine extension: 45HC is a real priceable container", () => {
  // A card that DOES define a 45HC base (shape of the new NLRTM-USLAX lane).
  const uslaxCard: RateCard = {
    mode: "FCL",
    version: "2026-06-v1",
    validity_through: "2026-06-30",
    supported_lane: "NLRTM-USLAX",
    base_per_container: { "20GP": 2200, "40GP": 2900, "40HC": 3050, "45HC": 3250 },
    surcharges: [
      { code: "BAF", amount_per_container: 360 },
      { code: "CAF", amount_per_container: 140 },
      { code: "THC_RTM", amount_per_container: 225 },
      { code: "THC_LAX", amount_per_container: 310 },
      { code: "ISPS", amount_per_container: 25 },
      { code: "PSS", amount_per_container: 200 },
    ],
    per_shipment_fees: [
      { code: "DOC", amount: 65 },
      { code: "EXPORT_CUSTOMS", amount: 45 },
    ],
  };

  it("prices a 45HC on a card that defines a 45HC base", () => {
    const q = priceQuote(
      {
        origin_port_code: "NLRTM",
        destination_port_code: "USLAX",
        mode: "FCL",
        container_type: "45HC",
        container_qty: 1,
      },
      uslaxCard,
    );
    expect(q.container_type).toBe("45HC");
    expect(q.base_per_container).toBe(3250);
    // 3250 + (360+140+225+310+25+200) + (65+45) = 4620
    expect(q.all_in_total).toBe(4620);
  });

  it("refuses a 45HC on a card without a 45HC base (out_of_scope_container)", () => {
    // default RATE_CARD (NLRTM-USNYC) has no 45HC base
    const call = () => priceQuote(inScope({ container_type: "45HC" }));
    expect(call).toThrow(UnpriceableRequestError);
    try {
      call();
    } catch (e) {
      expect((e as UnpriceableRequestError).reason).toBe("out_of_scope_container");
    }
  });

  it("still prices the existing 3 types byte-identically (40HC×1 = 3520)", () => {
    expect(priceQuote(inScope({ container_type: "40HC", container_qty: 1 })).all_in_total).toBe(3520);
  });
});

describe("AC-B1/B2/B3 — barge (per_container) via the same engine", () => {
  const bargeCard: RateCard = {
    mode: "BARGE",
    version: "2026-06-v1",
    validity_through: "2026-06-30",
    supported_lane: "NLRTM-DEDUI",
    base_per_container: { "20GP": 280, "40GP": 420, "40HC": 420 },
    surcharges: [
      { code: "LWS", amount_per_container: 95 },
      { code: "THC_RTM_BARGE", amount_per_container: 95 },
      { code: "THC_DUI", amount_per_container: 110 },
    ],
    per_shipment_fees: [{ code: "DOC", amount: 35 }],
  };
  const bargeReq = (over: Partial<PriceRequest> = {}): PriceRequest => ({
    origin_port_code: "NLRTM",
    destination_port_code: "DEDUI",
    mode: "BARGE",
    container_type: "40HC",
    container_qty: 1,
    ...over,
  });

  it("AC-B1: 1×40HC barge = 755 EUR (incl. LWS)", () => {
    const q = priceQuote(bargeReq(), bargeCard);
    expect(q.all_in_total).toBe(755);
    expect(q.lane).toBe("NLRTM-DEDUI");
    expect(q.surcharges.find((s) => s.code === "LWS")?.amount_per_container).toBe(95);
  });
  it("AC-B1: 2×20GP barge = 1195 EUR", () => {
    expect(priceQuote(bargeReq({ container_type: "20GP", container_qty: 2 }), bargeCard).all_in_total).toBe(1195);
  });
  it("AC-B2: AIR (basis not implemented) → out_of_scope_mode", () => {
    const call = () => priceQuote(bargeReq({ mode: "AIR" }), bargeCard);
    expect(call).toThrow(UnpriceableRequestError);
    try { call(); } catch (e) { expect((e as UnpriceableRequestError).reason).toBe("out_of_scope_mode"); }
  });
  it("AC-B3: FCL request against a BARGE card → out_of_scope_mode", () => {
    const call = () => priceQuote(bargeReq({ mode: "FCL" }), bargeCard);
    expect(call).toThrow(UnpriceableRequestError);
    try { call(); } catch (e) { expect((e as UnpriceableRequestError).reason).toBe("out_of_scope_mode"); }
  });
  it("AC-B3: barge on a non-barge lane → out_of_scope_lane", () => {
    const call = () => priceQuote(bargeReq({ destination_port_code: "USNYC" }), bargeCard);
    expect(call).toThrow(UnpriceableRequestError);
    try { call(); } catch (e) { expect((e as UnpriceableRequestError).reason).toBe("out_of_scope_lane"); }
  });
});

describe("cardFor — resolve the card for a request's mode+lane", () => {
  it("StaticCard returns its card on a matching mode+lane, null otherwise", async () => {
    const eng = new StaticCardRateEngine(); // FCL NLRTM-USNYC
    expect(await eng.cardFor(inScope({}))).not.toBeNull();
    expect(await eng.cardFor(inScope({ mode: "BARGE" }))).toBeNull(); // wrong mode
    expect(await eng.cardFor(inScope({ destination_port_code: "DEDUI" }))).toBeNull(); // wrong lane
  });
});

describe("Gate-4 hardening — price(req, card) honours the PROVIDED card (no re-resolution)", () => {
  const bargeCard: RateCard = {
    mode: "BARGE",
    version: "2026-06-v1",
    validity_through: "2026-06-30",
    supported_lane: "NLRTM-DEDUI",
    base_per_container: { "40HC": 420 },
    surcharges: [
      { code: "LWS", amount_per_container: 95 },
      { code: "THC_RTM_BARGE", amount_per_container: 95 },
      { code: "THC_DUI", amount_per_container: 110 },
    ],
    per_shipment_fees: [{ code: "DOC", amount: 35 }],
  };

  it("prices the passed card, not the engine's own — closing the gate→price TOCTOU window", async () => {
    const eng = new StaticCardRateEngine(); // its own card is FCL NLRTM-USNYC
    const q = await eng.price(
      { origin_port_code: "NLRTM", destination_port_code: "DEDUI", mode: "BARGE", container_type: "40HC", container_qty: 1 },
      bargeCard,
    );
    expect(q.all_in_total).toBe(755); // 420 + 95 + 95 + 110 + 35 — proves the BARGE card was used
    expect(q.lane).toBe("NLRTM-DEDUI");
  });
});
