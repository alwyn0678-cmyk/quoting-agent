import { describe, it, expect } from "vitest";
import { buildUsageView, type RawUsageRow } from "./usage.js";

describe("P-1C.6 — usage view (observability)", () => {
  it("surfaces well-formed usage on BOTH quote and escalate paths + tenant totals (T13 parity)", () => {
    const rows: RawUsageRow[] = [
      {
        id: "u1",
        request_id: "rq",
        event: "quote",
        model: "claude-sonnet-4-6 (extract), claude-haiku-4-5-20251001 (draft)",
        input_tokens: 1200,
        output_tokens: 350,
        est_cost_usd: 0.044,
        created_at: "2026-05-25T10:00:00Z",
      },
      {
        id: "u2",
        request_id: "re",
        event: "escalate",
        model: "claude-sonnet-4-6 (extract)",
        input_tokens: 800,
        output_tokens: 120,
        est_cost_usd: 0.021,
        created_at: "2026-05-25T09:00:00Z",
      },
    ];

    const view = buildUsageView(rows);

    expect(view.rows).toHaveLength(2);
    for (const r of view.rows) {
      // T13: model present, tokens > 0, est cost >= 0 — on both paths
      expect(typeof r.model).toBe("string");
      expect((r.model ?? "").length).toBeGreaterThan(0);
      expect(r.input_tokens).toBeGreaterThan(0);
      expect(r.output_tokens).toBeGreaterThan(0);
      expect(r.est_cost_usd).toBeGreaterThanOrEqual(0);
    }
    expect(view.rows.map((r) => r.event).sort()).toEqual(["escalate", "quote"]); // both paths present
    expect(view.totals.runs).toBe(2);
    expect(view.totals.input_tokens).toBe(2000);
    expect(view.totals.output_tokens).toBe(470);
    expect(view.totals.est_cost_usd).toBeCloseTo(0.065, 6);
  });

  it("coerces nullable/string numerics and ignores non-usage rows (no model recorded)", () => {
    const rows: RawUsageRow[] = [
      { id: "u1", request_id: "r1", event: "quote", model: "m", input_tokens: null, output_tokens: 10, est_cost_usd: "0.5", created_at: "t1" },
      { id: "u2", request_id: "r2", event: "received", model: null, input_tokens: null, output_tokens: null, est_cost_usd: null, created_at: "t2" },
    ];
    const view = buildUsageView(rows);
    expect(view.rows).toHaveLength(1); // the no-model 'received' row is not a usage row
    expect(view.rows[0]?.input_tokens).toBe(0); // null -> 0
    expect(view.rows[0]?.est_cost_usd).toBe(0.5); // string -> number
    expect(view.totals.runs).toBe(1);
  });
});
