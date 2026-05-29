import { describe, it, expect } from "vitest";
import { runAndPersist, type RunStore, type UsageRecord } from "./run.js";
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

const TENANT = "11111111-1111-4111-8111-111111111111";
const REQ = "req-1";

interface StoredReq {
  id: string;
  tenant_id: string;
  from_email: string | null;
  subject: string | null;
  body: string | null;
  status: string;
  reason: string | null;
  flag: boolean;
}

/** In-memory store mirroring the DB: claim is tenant-scoped + state-machined (received/processing ->
 *  processing); quotes/drafts insert-once; complete is first-writer (only from 'processing'). */
class FakeRunStore implements RunStore {
  requests = new Map<string, StoredReq>();
  quotes = new Map<string, { tenant_id: string; quote: RateQuote }>();
  drafts = new Map<string, { tenant_id: string; draft: { subject: string; body: string } }>();
  usage: { tenant_id: string; decision: string; usage: UsageRecord; flag: boolean }[] = [];
  tenantsTouched = new Set<string>();

  seed(r: { id: string; tenant_id: string; from_email?: string; subject?: string; body?: string }) {
    this.requests.set(r.id, {
      id: r.id,
      tenant_id: r.tenant_id,
      from_email: r.from_email ?? "maria@apex.example",
      subject: r.subject ?? "Quote RTM->NY",
      body: r.body ?? "Please quote 2 x 40HC Rotterdam to New York.",
      status: "received",
      reason: null,
      flag: false,
    });
  }

  async claim(tenantId: string, requestId: string) {
    const r = this.requests.get(requestId);
    if (!r || r.tenant_id !== tenantId) return null; // tenant gate (#1)
    if (r.status !== "received" && r.status !== "processing") return null; // already terminal -> skip (#2)
    r.status = "processing";
    return { id: r.id, tenant_id: r.tenant_id, from_email: r.from_email, subject: r.subject, body: r.body };
  }
  async saveQuote(requestId: string, tenantId: string, quote: RateQuote) {
    this.tenantsTouched.add(tenantId);
    if (!this.quotes.has(requestId)) this.quotes.set(requestId, { tenant_id: tenantId, quote });
  }
  async saveDraft(requestId: string, tenantId: string, draft: { subject: string; body: string }) {
    this.tenantsTouched.add(tenantId);
    if (!this.drafts.has(requestId)) this.drafts.set(requestId, { tenant_id: tenantId, draft });
  }
  async complete(requestId: string, tenantId: string, status: "awaiting_review" | "escalated", reason: string | null, flag: boolean) {
    this.tenantsTouched.add(tenantId);
    const r = this.requests.get(requestId);
    if (r && r.tenant_id === tenantId && r.status === "processing") {
      r.status = status;
      r.reason = reason;
      r.flag = flag;
    }
  }
  async logUsage(_requestId: string, tenantId: string, decision: "quote" | "escalate", usage: UsageRecord, flag: boolean) {
    this.tenantsTouched.add(tenantId);
    this.usage.push({ tenant_id: tenantId, decision, usage, flag });
  }
}

const deps = (client: RoutingMockLlmClient) => ({ client, engine: new StaticCardRateEngine() });

describe("1C.2 — durable agent-run (claim + idempotent persistence)", () => {
  it("P-1C.2: a retry after success re-runs nothing — one quote, one draft, one usage row", async () => {
    const store = new FakeRunStore();
    store.seed({ id: REQ, tenant_id: TENANT });

    const r1 = await runAndPersist(TENANT, REQ, deps(routed(baseExtraction)), store);
    expect(r1).toMatchObject({ ran: true, decision: "quote", status: "awaiting_review" });

    // a Trigger.dev retry of an already-completed request
    const retryClient = routed(baseExtraction);
    const r2 = await runAndPersist(TENANT, REQ, deps(retryClient), store);
    expect(r2).toEqual({ ran: false, reason: "not_claimable" }); // terminal -> claim refused
    expect(retryClient.calls).toHaveLength(0); // the model was NOT re-invoked (no flip, no re-bill)

    expect(store.quotes.size).toBe(1);
    expect(store.drafts.size).toBe(1);
    expect(store.quotes.get(REQ)?.quote.all_in_total).toBe(6930);
    expect(store.usage).toHaveLength(1);
    expect(store.requests.get(REQ)?.status).toBe("awaiting_review");
  });

  it("escalate path persists status + reason, no quote/draft", async () => {
    const store = new FakeRunStore();
    store.seed({ id: REQ, tenant_id: TENANT });
    const r = await runAndPersist(TENANT, REQ, deps(routed({ ...baseExtraction, container_type: "UNKNOWN", container_qty: null })), store);
    expect(r).toMatchObject({ ran: true, decision: "escalate", status: "escalated", escalation_reason: "missing_required_field" });
    expect(store.quotes.size).toBe(0);
    expect(store.drafts.size).toBe(0);
    expect(store.requests.get(REQ)?.status).toBe("escalated");
    expect(store.usage).toHaveLength(1); // escalate path still records usage (T13)
  });

  it("#1 tenant gate: a run for the WRONG tenant claims nothing — no model call, no writes", async () => {
    const store = new FakeRunStore();
    store.seed({ id: REQ, tenant_id: TENANT });
    const client = routed(baseExtraction);
    const r = await runAndPersist("99999999-9999-4999-8999-999999999999", REQ, deps(client), store);
    expect(r).toEqual({ ran: false, reason: "not_claimable" });
    expect(client.calls).toHaveLength(0);
    expect(store.quotes.size).toBe(0);
    expect(store.drafts.size).toBe(0);
    expect(store.usage).toHaveLength(0);
    expect(store.tenantsTouched.size).toBe(0); // never touched any tenant's rows
    expect(store.requests.get(REQ)?.status).toBe("received"); // untouched
  });

  it("P-TENANT: every write carries ONLY the request's own tenant_id", async () => {
    const store = new FakeRunStore();
    store.seed({ id: REQ, tenant_id: TENANT });
    await runAndPersist(TENANT, REQ, deps(routed(baseExtraction)), store);
    expect([...store.tenantsTouched]).toEqual([TENANT]);
    expect(store.quotes.get(REQ)?.tenant_id).toBe(TENANT);
    expect(store.drafts.get(REQ)?.tenant_id).toBe(TENANT);
  });
});
