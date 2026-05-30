import { describe, it, expect } from "vitest";
import { buildRequestView, quotationsOnly, type RawRequestRow, type RequestView } from "./dashboard.js";
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
      escalation_reason: null,
      injection_flag: false,
      quotes: [{ breakdown_snapshot: quote }],
      drafts: [
        { subject: "Re: Quote RTM->NYC", body: "Dear Maria, all-in EUR 6,930.", simulated_sent_at: null },
      ],
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
    expect(view.draft?.simulated_sent_at).toBeNull(); // awaiting_review: not yet (simulated-)sent
  });

  it("surfaces drafts.simulated_sent_at once the request has been approved (SIMULATED SEND)", async () => {
    const quote = await new StaticCardRateEngine().price({
      origin_port_code: "NLRTM",
      destination_port_code: "USNYC",
      mode: "FCL",
      container_type: "40HC",
      container_qty: 1,
    });
    const row: RawRequestRow = {
      id: "r-sent",
      status: "sent",
      from_email: "maria@apex.example",
      subject: "Quote RTM->NYC",
      created_at: "2026-05-20T10:00:00Z",
      escalation_reason: null,
      injection_flag: false,
      quotes: [{ breakdown_snapshot: quote }],
      drafts: [{ subject: "Re", body: "all-in EUR 3,465.", simulated_sent_at: "2026-05-23T09:15:00Z" }],
    };
    const view = buildRequestView(row);
    expect(view.status).toBe("sent");
    expect(view.draft?.simulated_sent_at).toBe("2026-05-23T09:15:00Z");
  });

  it("AC-8 — escalated request surfaces the reason and has no quote/draft (so the UI offers no send)", () => {
    const row: RawRequestRow = {
      id: "r2",
      status: "escalated",
      from_email: "x@y.example",
      subject: "LCL?",
      created_at: "2026-05-21T10:00:00Z",
      escalation_reason: "out_of_scope_mode",
      injection_flag: false,
      quotes: [],
      drafts: [],
    };
    const view = buildRequestView(row);
    expect(view.status).toBe("escalated");
    expect(view.escalation_reason).toBe("out_of_scope_mode");
    expect(view.quote).toBeNull(); // no quote -> the approve button is never rendered (no send)
    expect(view.draft).toBeNull();
  });

  it("AC-8 / fixture-07 parity — an injection-flagged request is still a valid quote (quote-and-flag)", async () => {
    // Fixture 07: a valid request carrying an injection attack. Expected outcome: decision 'quote',
    // injection_flag true, the REAL lane price (3520) — NOT the injected EUR 1 — and no escalation.
    const quote = await new StaticCardRateEngine().price({
      origin_port_code: "NLRTM",
      destination_port_code: "USNYC",
      mode: "FCL",
      container_type: "40HC",
      container_qty: 1,
    });
    expect(quote.all_in_total).toBe(3520); // fixture-07's expected engine total
    const row: RawRequestRow = {
      id: "r-inj",
      status: "awaiting_review",
      from_email: "buyer@trojanimports.example",
      subject: "Quote request 1x40HC Rotterdam to New York",
      created_at: "2026-05-24T10:00:00Z",
      escalation_reason: null,
      injection_flag: true,
      quotes: [{ breakdown_snapshot: quote }],
      drafts: [{ subject: "Re", body: "all-in EUR 3,520.", simulated_sent_at: null }],
    };
    const view = buildRequestView(row);
    expect(view.injection_flag).toBe(true); // surfaced -> the ⚠ injection flagged badge
    expect(view.escalation_reason).toBeNull(); // flagged, NOT escalated
    expect(view.quote?.all_in_total).toBe(3520); // priced by code, not the injected EUR 1
    expect(view.quote).not.toBeNull(); // quote-and-flag: still reviewable/approvable
    expect(view.draft).not.toBeNull();
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

  it("AC-D1: carries the inbound email body into the view", async () => {
    const row: RawRequestRow = {
      id: "rb",
      status: "awaiting_review",
      from_email: "maria@apex.example",
      subject: "Quote RTM->NYC",
      body: "Dear Linkport, please quote 2 x 40HC Rotterdam to New York.",
      created_at: "2026-05-20T10:00:00Z",
      escalation_reason: null,
      injection_flag: false,
      quotes: [],
      drafts: [],
    };
    expect(buildRequestView(row).body).toBe(
      "Dear Linkport, please quote 2 x 40HC Rotterdam to New York.",
    );
  });

  it("AC-D2: quotationsOnly keeps views with a quote, drops escalations", () => {
    const base = {
      created_at: "2026-05-20T10:00:00Z",
      injection_flag: false,
      body: "b",
    };
    const quoted: RequestView = {
      id: "q1",
      status: "awaiting_review",
      from_email: "a@x.example",
      subject: "s",
      escalation_reason: null,
      quote: {
        lane: "NLRTM-USNYC",
        container_type: "40HC",
        container_qty: 1,
        base_per_container: 2550,
        surcharges: [],
        per_shipment_fees: [],
        all_in_total: 3520,
        validity_through: "2026-06-30",
        rate_card_version: "2026-06-v1",
      },
      draft: null,
      ...base,
    };
    const escalated: RequestView = {
      id: "e1",
      status: "escalated",
      from_email: "b@y.example",
      subject: "s2",
      escalation_reason: "out_of_scope_mode",
      quote: null,
      draft: null,
      ...base,
    };
    expect(quotationsOnly([quoted, escalated]).map((v) => v.id)).toEqual(["q1"]);
  });
});
