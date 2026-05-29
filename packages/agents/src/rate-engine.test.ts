import { describe, it, expect } from "vitest";
import {
  priceQuote,
  StaticCardRateEngine,
  UnpriceableRequestError,
  type PriceRequest,
} from "./rate-engine.js";

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

  it("rejects with the same error as priceQuote() on an unpriceable request", async () => {
    await expect(new StaticCardRateEngine().price(inScope({ mode: "LCL" }))).rejects.toBeInstanceOf(
      UnpriceableRequestError,
    );
  });
});
