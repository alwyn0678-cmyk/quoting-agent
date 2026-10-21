import { describe, it, expect } from "vitest";
import {
  buildRequestView,
  quotationsOnly,
  activeOnly,
  archivedOnly,
  type RawRequestRow,
  type RequestView,
  type QuoteV1View,
  type QuoteV2View,
} from "./dashboard.js";
import { StaticCardRateEngine } from "../../../../packages/agents/src/rate-engine.js";
import { QuoteViewV2Schema, type QuoteViewV2 } from "../../../../packages/agents/src/pipeline/output.js";

/** Narrow a view's quote to the v1 shape (fails the test otherwise). */
function v1(view: RequestView): QuoteV1View {
  if (view.quote?.version !== 1) throw new Error(`expected a v1 quote, got ${String(view.quote?.version)}`);
  return view.quote;
}
function v2(view: RequestView): QuoteV2View {
  if (view.quote?.version !== 2) throw new Error(`expected a v2 quote, got ${String(view.quote?.version)}`);
  return view.quote;
}

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
    expect(v1(view).all_in_total).toBe(6930);
    expect(v1(view).base_per_container).toBe(quote.base_per_container);
    expect(v1(view).surcharges).toEqual(quote.surcharges);
    expect(v1(view).per_shipment_fees).toEqual(quote.per_shipment_fees);
    expect(v1(view).lane).toBe("NLRTM-USNYC");
    expect(v1(view).rate_card_version).toBe(quote.rate_card_version);
    // version-aware summary: the v1 list/outcome text is unchanged
    expect(v1(view).headline).toBe("NLRTM-USNYC · 2×40HC");
    expect(v1(view).total).toBe("EUR 6,930");
    expect(v1(view).validity).toBe(quote.validity_through);
    expect(v1(view).option_count).toBe(1);
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
    expect(v1(view).all_in_total).toBe(3520); // priced by code, not the injected EUR 1
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
    expect(v1(view).all_in_total).toBe(2770);
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
      archived_at: null,
      injection_flag: false,
      body: "b",
    };
    const quoted: RequestView = {
      id: "q1",
      status: "awaiting_review",
      from_email: "a@x.example",
      subject: "s",
      escalation_reason: null,
      missing_fields: [],
      quote: {
        version: 1,
        headline: "NLRTM-USNYC · 1×40HC",
        total: "EUR 3,520",
        validity: "2026-06-30",
        option_count: 1,
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
      missing_fields: [],
      quote: null,
      draft: null,
      ...base,
    };
    expect(quotationsOnly([quoted, escalated]).map((v) => v.id)).toEqual(["q1"]);
  });
});

describe("D-27 / archive — real send timestamp + archived filtering", () => {
  const baseRow = (over: Partial<RawRequestRow>): RawRequestRow => ({
    id: "r",
    status: "sent",
    from_email: "a@x.example",
    subject: "s",
    created_at: "2026-06-01T10:00:00Z",
    escalation_reason: null,
    injection_flag: false,
    quotes: [],
    drafts: [],
    ...over,
  });

  it("surfaces a REAL send (drafts.sent_at) distinctly from the legacy simulated_sent_at", () => {
    const v = buildRequestView(
      baseRow({
        drafts: [{ subject: "Re", body: "All-in EUR 3,520.", simulated_sent_at: "2026-06-01T16:00:00Z", sent_at: "2026-06-01T16:00:01Z" }],
      }),
    );
    expect(v.draft?.sent_at).toBe("2026-06-01T16:00:01Z");
    expect(v.draft?.simulated_sent_at).toBe("2026-06-01T16:00:00Z");
  });

  it("defaults archived_at and draft.sent_at to null when absent (back-compat with pre-0011 rows)", () => {
    const v = buildRequestView(
      baseRow({ drafts: [{ subject: "Re", body: "b", simulated_sent_at: "2026-06-01T16:00:00Z" }] }),
    );
    expect(v.archived_at).toBeNull();
    expect(v.draft?.sent_at).toBeNull();
  });

  it("activeOnly / archivedOnly partition by archived_at", () => {
    const active = buildRequestView(baseRow({ id: "a", archived_at: null }));
    const archived = buildRequestView(baseRow({ id: "b", archived_at: "2026-06-01T17:00:00Z" }));
    const all = [active, archived];
    expect(activeOnly(all).map((v) => v.id)).toEqual(["a"]);
    expect(archivedOnly(all).map((v) => v.id)).toEqual(["b"]);
  });
});

describe("P1a switch — v2 quotes (QuoteViewV2 snapshot) alongside v1", () => {
  const option = (id: string, total: string, currency: string, over: Partial<QuoteViewV2["options"][number]> = {}) => ({
    option_id: id,
    carrier_label: null,
    mode: "FCL",
    route: "Shanghai (CNSHA) → Rotterdam (NLRTM)",
    transit_days: 32,
    valid_until: "2026-11-30",
    lines: [{ code: "OFR", label: "Ocean freight", quantity: "2 × 40' High Cube", sell: { minor: total, currency } }],
    total: { minor: total, currency },
    fx_notes: [],
    ...over,
  });
  const v2Row = (snapshot: unknown, over: Partial<RawRequestRow> = {}): RawRequestRow => ({
    id: "v2",
    status: "awaiting_review",
    from_email: "buyer@example.test",
    subject: "Quote SHA->RTM",
    created_at: "2026-10-20T10:00:00Z",
    escalation_reason: null,
    injection_flag: false,
    quotes: [{ quote_version: 2, breakdown_snapshot: snapshot }],
    drafts: [],
    ...over,
  });

  it("a v2 row with 2 USD options maps to the first option's route/mode headline and exact total", () => {
    const snapshot: QuoteViewV2 = QuoteViewV2Schema.parse({
      quote_version: 2,
      quote_currency: "USD",
      options: [
        option("o1", "2110950", "USD", {
          carrier_label: "Carrier A",
          fx_notes: [{ from: "EUR", to: "USD", source: "ECB reference rates", as_of: "2026-10-01" }],
        }),
        option("o2", "2350000", "USD", { transit_days: null, valid_until: "2026-11-15" }),
      ],
    }); // the fixture is a real QuoteViewV2, so the local mirror is checked against the agent's schema
    const q = v2(buildRequestView(v2Row(snapshot)));
    expect(q.headline).toBe("Shanghai (CNSHA) → Rotterdam (NLRTM) · FCL · 2 options");
    expect(q.total).toBe("USD 21,109.50");
    expect(q.validity).toBe("2026-11-15"); // earliest valid_until across options
    expect(q.option_count).toBe(2);
    expect(q.currency).toBe("USD");
    expect(q.options.map((o) => o.total)).toEqual(["USD 21,109.50", "USD 23,500.00"]);
    expect(q.options[0]!.lines[0]).toEqual({ code: "OFR", label: "Ocean freight", quantity: "2 × 40' High Cube", sell: "USD 21,109.50" });
    expect(q.options[0]!.carrier_label).toBe("Carrier A");
    expect(q.options[0]!.fx_notes).toEqual([{ from: "EUR", to: "USD", source: "ECB reference rates", as_of: "2026-10-01" }]);
    expect(q.options[1]!.transit_days).toBeNull();
  });

  it("a JPY total renders with exponent 0 (no decimals)", () => {
    const snapshot = QuoteViewV2Schema.parse({ quote_version: 2, quote_currency: "JPY", options: [option("o1", "1234567", "JPY")] });
    const q = v2(buildRequestView(v2Row(snapshot)));
    expect(q.total).toBe("JPY 1,234,567");
    expect(q.headline).toBe("Shanghai (CNSHA) → Rotterdam (NLRTM) · FCL");
  });

  it("a malformed v2 snapshot falls back to an unreadable quote without throwing", () => {
    for (const bad of [
      null,
      "nope",
      { quote_version: 2, quote_currency: "USD", options: [] },
      { quote_version: 2, quote_currency: "USD", options: [option("o1", "21109.50", "USD")] }, // major units, not minor
      { quote_version: 2, quote_currency: "XXX", options: [option("o1", "100", "XXX")] }, // currency outside allowlist
      { quote_version: 2, quote_currency: "USD", options: [{ option_id: "o1" }] },
    ]) {
      const view = buildRequestView(v2Row(bad));
      expect(view.quote?.version).toBe("unreadable");
      expect(view.quote?.total).toBeNull();
      expect(quotationsOnly([view])).toHaveLength(1); // still listed for review, with a safe notice
    }
  });

  it("a v1 row tagged quote_version 1 is unchanged by the switch", async () => {
    const quote = await new StaticCardRateEngine().price({
      origin_port_code: "NLRTM",
      destination_port_code: "USNYC",
      mode: "FCL",
      container_type: "40HC",
      container_qty: 1,
    });
    const q = v1(buildRequestView(v2Row(quote, { quotes: [{ quote_version: 1, breakdown_snapshot: quote }] })));
    expect(q.all_in_total).toBe(3520);
    expect(q.headline).toBe("NLRTM-USNYC · 1×40HC");
    expect(q.total).toBe("EUR 3,520");
    expect(q.surcharges).toEqual(quote.surcharges);
  });

  it("surfaces outcome_detail.missing_fields on an escalation; [] when absent (pre-0021 rows)", () => {
    const esc = buildRequestView(
      v2Row(null, {
        status: "escalated",
        escalation_reason: "missing_required_field",
        quotes: [],
        outcome_detail: { reason: "missing_required_field", missing_fields: ["origin", "weight"], options_presented: 0, candidates: 0 },
      }),
    );
    expect(esc.missing_fields).toEqual(["origin", "weight"]);
    expect(esc.quote).toBeNull();
    expect(buildRequestView(v2Row(null, { quotes: [] })).missing_fields).toEqual([]);
  });
});
