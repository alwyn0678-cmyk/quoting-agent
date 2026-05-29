import { describe, it, expect } from "vitest";
import { runAndPersist, type RequestRow, type RunStore, type UsageRecord } from "./run.js";
import { RoutingMockLlmClient } from "../../agents/src/mock-llm.js";
import { StaticCardRateEngine } from "../../agents/src/rate-engine.js";
import type { RateQuote, ExtractionResult } from "../../agents/src/schemas.js";

const baseExtraction: ExtractionResult = {
  origin: { raw: "Rotterdam", port_code: "NLRTM" },
  destination: { raw: "New York", port_code: "USNYC" },
  mode: "FCL",
  container_type: "40HC",
  container_qty: 2,
  incoterm: "FOB",
  commodity: "coffee",
  ready_date: null,
  weight_kg: null,
  requester_name: "Maria",
  requester_company: "Apex",
  field_confidence: {},
  overall_confidence: 0.95,
  injection_detected: false,
};

const routed = (extraction: ExtractionResult, draftBody = "all-in EUR 6,930.") =>
  new RoutingMockLlmClient({
    submit_extraction: { data: extraction, usage: { input_tokens: 300, output_tokens: 90 } },
    submit_draft: { data: { subject: "Re: Quote request", body: draftBody }, usage: { input_tokens: 250, output_tokens: 140 } },
  });

const request: RequestRow = {
  id: "req-1",
  tenant_id: "11111111-1111-4111-8111-111111111111",
  from_email: "maria@apex.example",
  subject: "Quote RTM->NY",
  body: "Please quote 2 x 40HC Rotterdam to New York.",
};

/** In-memory store mirroring the DB: quotes/drafts are insert-once by request_id; usage appends. */
class FakeRunStore implements RunStore {
  quotes = new Map<string, { tenant_id: string; quote: RateQuote }>();
  drafts = new Map<string, { tenant_id: string; draft: { subject: string; body: string } }>();
  outcomes = new Map<string, { tenant_id: string; status: string; reason: string | null; flag: boolean }>();
  usage: { tenant_id: string; decision: string; usage: UsageRecord; flag: boolean }[] = [];
  tenantsTouched = new Set<string>();

  async saveQuote(requestId: string, tenantId: string, quote: RateQuote) {
    this.tenantsTouched.add(tenantId);
    if (!this.quotes.has(requestId)) this.quotes.set(requestId, { tenant_id: tenantId, quote }); // insert-once
  }
  async saveDraft(requestId: string, tenantId: string, draft: { subject: string; body: string }) {
    this.tenantsTouched.add(tenantId);
    if (!this.drafts.has(requestId)) this.drafts.set(requestId, { tenant_id: tenantId, draft }); // insert-once
  }
  async setOutcome(requestId: string, tenantId: string, status: "awaiting_review" | "escalated", reason: string | null, flag: boolean) {
    this.tenantsTouched.add(tenantId);
    this.outcomes.set(requestId, { tenant_id: tenantId, status, reason, flag });
  }
  async logUsage(_requestId: string, tenantId: string, decision: "quote" | "escalate", usage: UsageRecord, flag: boolean) {
    this.tenantsTouched.add(tenantId);
    this.usage.push({ tenant_id: tenantId, decision, usage, flag });
  }
}

const deps = (client: RoutingMockLlmClient) => ({ client, engine: new StaticCardRateEngine() });

describe("1C.2 — durable agent-run (idempotent persistence)", () => {
  it("P-1C.2: re-running yields exactly ONE quote + ONE draft (insert-once on request_id)", async () => {
    const store = new FakeRunStore();

    const r1 = await runAndPersist(request, deps(routed(baseExtraction)), store);
    expect(r1.decision).toBe("quote");
    expect(r1.status).toBe("awaiting_review");

    // a Trigger.dev retry re-runs the body
    const r2 = await runAndPersist(request, deps(routed(baseExtraction)), store);
    expect(r2.decision).toBe("quote");

    expect(store.quotes.size).toBe(1); // never duplicated
    expect(store.drafts.size).toBe(1);
    expect(store.quotes.get("req-1")?.quote.all_in_total).toBe(6930);
    expect(store.usage).toHaveLength(2); // each invocation is recorded (T13)
    expect(store.outcomes.get("req-1")?.status).toBe("awaiting_review");
  });

  it("escalate path persists status + reason, no quote/draft", async () => {
    const store = new FakeRunStore();
    const client = routed({ ...baseExtraction, container_type: "UNKNOWN", container_qty: null });
    const r = await runAndPersist(request, deps(client), store);
    expect(r.decision).toBe("escalate");
    expect(r.status).toBe("escalated");
    expect(r.escalation_reason).toBe("missing_required_field");
    expect(store.quotes.size).toBe(0);
    expect(store.drafts.size).toBe(0);
    expect(store.outcomes.get("req-1")?.reason).toBe("missing_required_field");
    expect(store.usage).toHaveLength(1); // escalate path still logs usage (T13)
  });

  it("P-TENANT: every write carries ONLY the request's own tenant_id", async () => {
    const store = new FakeRunStore();
    await runAndPersist(request, deps(routed(baseExtraction)), store);
    expect([...store.tenantsTouched]).toEqual([request.tenant_id]); // never another tenant
    expect(store.quotes.get("req-1")?.tenant_id).toBe(request.tenant_id);
    expect(store.drafts.get("req-1")?.tenant_id).toBe(request.tenant_id);
  });
});
