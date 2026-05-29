import { describe, it, expect } from "vitest";
import { quoteToRow } from "./quote-store.js";
import { StaticCardRateEngine } from "./rate-engine.js";

describe("1B.4 — quote snapshot row mapping", () => {
  it("freezes the full RateQuote into breakdown_snapshot + scalar columns", async () => {
    const quote = await new StaticCardRateEngine().price({
      origin_port_code: "NLRTM",
      destination_port_code: "USNYC",
      mode: "FCL",
      container_type: "40HC",
      container_qty: 2,
    });

    const row = quoteToRow("req-1", "tenant-1", quote);

    expect(row.request_id).toBe("req-1");
    expect(row.tenant_id).toBe("tenant-1");
    expect(row.all_in_total).toBe(6930);
    expect(row.rate_card_version).toBe(quote.rate_card_version);
    expect(row.container_type).toBe("40HC");
    expect(row.container_qty).toBe(2);
    expect(row.validity_through).toBe(quote.validity_through);
    expect(row.breakdown_snapshot).toEqual(quote); // the full immutable copy
  });
});
