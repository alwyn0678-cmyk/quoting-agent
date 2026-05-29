import { describe, it, expect } from "vitest";
import { buildRequestView, type RawRequestRow } from "./dashboard.js";
import { StaticCardRateEngine } from "../../../../packages/agents/src/rate-engine.js";

describe("P-1C.3 — dashboard render model", () => {
  it("derives the breakdown view from quote.breakdown_snapshot; renders draft", async () => {
    const quote = await new StaticCardRateEngine().price({
      origin_port_code: "NLRTM",
      destination_port_code: "USNYC",
      mode: "FCL",
      container_type: "40HC",
      container_qty: 2,
    });
    const row: RawRequestRow = {
      id: "r1",
      status: "awaiting_review",
      from_email: "maria@apex.example",
      subject: "Quote RTM->NYC",
      created_at: "2026-05-20T10:00:00Z",
      quotes: [{ breakdown_snapshot: quote }],
      drafts: [{ subject: "Re: Quote RTM->NYC", body: "Dear Maria, all-in EUR 6,930." }],
    };

    const view = buildRequestView(row);

    expect(view.status).toBe("awaiting_review");
    expect(view.from_email).toBe("maria@apex.example");
    // the breakdown shown equals the snapshot's line items (P-1C.3)
    expect(view.quote?.all_in_total).toBe(6930);
    expect(view.quote?.base_per_container).toBe(quote.base_per_container);
    expect(view.quote?.surcharges).toEqual(quote.surcharges);
    expect(view.quote?.per_shipment_fees).toEqual(quote.per_shipment_fees);
    expect(view.quote?.lane).toBe("NLRTM-USNYC");
    expect(view.quote?.rate_card_version).toBe(quote.rate_card_version);
    expect(view.draft?.body).toContain("6,930");
  });

  it("renders an escalated request with no quote / no draft", () => {
    const row: RawRequestRow = {
      id: "r2",
      status: "escalated",
      from_email: "x@y.example",
      subject: "LCL?",
      created_at: "2026-05-21T10:00:00Z",
      quotes: [],
      drafts: [],
    };
    const view = buildRequestView(row);
    expect(view.status).toBe("escalated");
    expect(view.quote).toBeNull();
    expect(view.draft).toBeNull();
  });

  it("handles PostgREST returning an embedded object instead of an array", async () => {
    const quote = await new StaticCardRateEngine().price({
      origin_port_code: "NLRTM",
      destination_port_code: "USNYC",
      mode: "FCL",
      container_type: "20GP",
      container_qty: 1,
    });
    const row = {
      id: "r3",
      status: "awaiting_review",
      from_email: null,
      subject: null,
      created_at: "2026-05-22T10:00:00Z",
      quotes: { breakdown_snapshot: quote },
      drafts: { subject: "s", body: "all-in EUR 2,770." },
    } as unknown as RawRequestRow;
    const view = buildRequestView(row);
    expect(view.quote?.all_in_total).toBe(2770);
    expect(view.draft?.body).toContain("2,770");
  });
});
