import { describe, it, expect } from "vitest";
import { runAndPersist, type RunStore, type UsageRecord, type PersistOutcome, type RunDeps } from "./run.js";
import { legacyStaticSource } from "../../agents/src/sources/tariff-source.js";
import { legacyTenantConfig } from "../../agents/src/pipeline/tenant.js";
import { pipelineLlm, SAMPLE_FCL_REQUEST } from "../../agents/src/pipeline/testing.js";
import { LlmOutputError, LlmRefusalError, type LlmClient } from "../../agents/src/llm.js";
import type { QuoteRowV2 } from "../../agents/src/pipeline/output.js";
import type { Wire } from "../../core/src/pricing/wire.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const REQ = "req-1";
const OWNER = "run_abc";
const AS_OF = { asOf: "2026-06-01" };

interface StoredReq {
  id: string;
  tenant_id: string;
  from_email: string | null;
  subject: string | null;
  body: string | null;
  status: string;
  reason: string | null;
  flag: boolean;
  owner: string | null;
  claimed_minutes_ago: number | null;
  outcome: unknown;
}

/** In-memory mirror of migration 0021: claim_request (owner + lease), owner-checked first-writer
 *  persist_run_outcome, insert-once quote/draft/internals, usage only on the winning transition. */
class FakeRunStore implements RunStore {
  requests = new Map<string, StoredReq>();
  quotes = new Map<string, { tenant_id: string; quote: QuoteRowV2 }>();
  drafts = new Map<string, { tenant_id: string; draft: { subject: string; body: string } }>();
  internals = new Map<string, { tenant_id: string; result: Wire }>();
  usage: { tenant_id: string; usage: UsageRecord }[] = [];
  tenantsTouched = new Set<string>();

  seed(r: { id: string; tenant_id: string }) {
    this.requests.set(r.id, {
      id: r.id,
      tenant_id: r.tenant_id,
      from_email: "maria@apex.example",
      subject: "Quote RTM->NY",
      body: "Please quote 2 x 40HC Rotterdam to New York.",
      status: "received",
      reason: null,
      flag: false,
      owner: null,
      claimed_minutes_ago: null,
      outcome: null,
    });
  }

  async claim(tenantId: string, requestId: string, owner: string) {
    const r = this.requests.get(requestId);
    if (!r || r.tenant_id !== tenantId) return null;
    const claimable =
      r.status === "received" ||
      (r.status === "processing" && (r.owner === owner || r.claimed_minutes_ago === null || r.claimed_minutes_ago > 70));
    if (!claimable) return null;
    r.status = "processing";
    r.owner = owner;
    r.claimed_minutes_ago = 0;
    return { id: r.id, tenant_id: r.tenant_id, from_email: r.from_email, subject: r.subject, body: r.body };
  }

  async persistOutcome(requestId: string, tenantId: string, owner: string, o: PersistOutcome): Promise<boolean> {
    const r = this.requests.get(requestId);
    // FIRST statement: owner- and tenant-checked transition; a mismatch writes nothing.
    if (!r || r.tenant_id !== tenantId || r.status !== "processing" || r.owner !== owner) return false;
    this.tenantsTouched.add(tenantId);
    r.status = o.status;
    r.reason = o.escalationReason;
    r.flag = o.injectionFlag;
    r.outcome = o.outcomeDetail;
    if (o.quote && !this.quotes.has(requestId)) this.quotes.set(requestId, { tenant_id: tenantId, quote: o.quote });
    if (o.draft && !this.drafts.has(requestId)) this.drafts.set(requestId, { tenant_id: tenantId, draft: o.draft });
    if (o.internals && !this.internals.has(requestId)) this.internals.set(requestId, { tenant_id: tenantId, result: o.internals });
    this.usage.push({ tenant_id: tenantId, usage: o.usage });
    return true;
  }
}

const deps = (llm: LlmClient, tenantId = TENANT): RunDeps => ({ llm, tariffs: legacyStaticSource(tenantId), tenant: legacyTenantConfig(tenantId), log: () => {} });

const throwingLlm = (err: Error): LlmClient => ({ callStructured: async () => { throw err; } });

describe("durable agent-run v2 — claim, lease ownership, idempotent persistence", () => {
  it("quote path persists a v2 quote row, the draft, internals and a public outcome", async () => {
    const store = new FakeRunStore();
    store.seed({ id: REQ, tenant_id: TENANT });
    const r = await runAndPersist(TENANT, REQ, OWNER, deps(pipelineLlm(SAMPLE_FCL_REQUEST)), store, AS_OF);
    expect(r).toMatchObject({ ran: true, decision: "quote", status: "awaiting_review", transitioned: true });
    const q = store.quotes.get(REQ)!.quote;
    expect(q).toMatchObject({ quote_version: 2, mode: "FCL", currency: "EUR", total_minor: "693000", option_count: 1, validity_through: "2026-06-15" });
    expect(store.drafts.get(REQ)!.draft.body).toContain("EUR 6,930.00");
    expect(JSON.stringify(store.internals.get(REQ)!.result)).toContain('"trace"');
    expect(store.requests.get(REQ)!.outcome).toEqual({ reason: null, missing_fields: [], options_presented: 1, candidates: 1 });
  });

  it("a retry after success re-runs nothing — one quote, one draft, one usage row, no model call", async () => {
    const store = new FakeRunStore();
    store.seed({ id: REQ, tenant_id: TENANT });
    await runAndPersist(TENANT, REQ, OWNER, deps(pipelineLlm(SAMPLE_FCL_REQUEST)), store, AS_OF);
    const retry = pipelineLlm(SAMPLE_FCL_REQUEST);
    const r2 = await runAndPersist(TENANT, REQ, OWNER, deps(retry), store, AS_OF);
    expect(r2).toEqual({ ran: false, reason: "not_claimable" });
    expect(retry.calls).toHaveLength(0);
    expect(store.quotes.size).toBe(1);
    expect(store.usage).toHaveLength(1);
  });

  it("a retry of the SAME owner mid-flight re-claims; a different owner cannot while the lease is live", async () => {
    const store = new FakeRunStore();
    store.seed({ id: REQ, tenant_id: TENANT });
    await store.claim(TENANT, REQ, OWNER); // first attempt crashed after claiming
    const other = await runAndPersist(TENANT, REQ, "run_other", deps(pipelineLlm(SAMPLE_FCL_REQUEST)), store, AS_OF);
    expect(other).toEqual({ ran: false, reason: "not_claimable" });
    const same = await runAndPersist(TENANT, REQ, OWNER, deps(pipelineLlm(SAMPLE_FCL_REQUEST)), store, AS_OF);
    expect(same).toMatchObject({ ran: true, transitioned: true });
  });

  it("a stolen lease: the original owner's late persist writes nothing", async () => {
    const store = new FakeRunStore();
    store.seed({ id: REQ, tenant_id: TENANT });
    await store.claim(TENANT, REQ, OWNER);
    store.requests.get(REQ)!.claimed_minutes_ago = 71; // stale
    await runAndPersist(TENANT, REQ, "run_new", deps(pipelineLlm(SAMPLE_FCL_REQUEST)), store, AS_OF);
    const late = await store.persistOutcome(REQ, TENANT, OWNER, {
      status: "escalated", escalationReason: "low_confidence", injectionFlag: false, quote: null, draft: null,
      usage: { model: "m", input_tokens: 0, output_tokens: 0, est_cost_usd: 0 }, extraction: null,
      outcomeDetail: { reason: "low_confidence", missing_fields: [], options_presented: 0, candidates: 0 }, internals: null,
    });
    expect(late).toBe(false);
    expect(store.requests.get(REQ)!.status).toBe("awaiting_review");
  });

  it("escalate path persists status + reason + missing fields, no quote/draft, still records usage", async () => {
    const store = new FakeRunStore();
    store.seed({ id: REQ, tenant_id: TENANT });
    const req = { ...SAMPLE_FCL_REQUEST, cargo: { ...SAMPLE_FCL_REQUEST.cargo, containers: [] } };
    const r = await runAndPersist(TENANT, REQ, OWNER, deps(pipelineLlm(req)), store, AS_OF);
    expect(r).toMatchObject({ decision: "escalate", status: "escalated", escalation_reason: "missing_required_field" });
    expect(store.quotes.size).toBe(0);
    expect(store.drafts.size).toBe(0);
    expect(store.requests.get(REQ)!.outcome).toMatchObject({ missing_fields: ["containers"] });
    expect(store.usage).toHaveLength(1);
  });

  it("tenant gate: a run for the WRONG tenant claims nothing — no model call, no writes", async () => {
    const store = new FakeRunStore();
    store.seed({ id: REQ, tenant_id: TENANT });
    const llm = pipelineLlm(SAMPLE_FCL_REQUEST);
    const r = await runAndPersist(OTHER, REQ, OWNER, deps(llm, OTHER), store, AS_OF);
    expect(r).toEqual({ ran: false, reason: "not_claimable" });
    expect(llm.calls).toHaveLength(0);
    expect(store.tenantsTouched.size).toBe(0);
    expect(store.requests.get(REQ)!.status).toBe("received");
  });

  it("a tenant config for another tenant is refused before claiming", async () => {
    const store = new FakeRunStore();
    store.seed({ id: REQ, tenant_id: TENANT });
    await expect(runAndPersist(TENANT, REQ, OWNER, deps(pipelineLlm(SAMPLE_FCL_REQUEST), OTHER), store, AS_OF)).rejects.toThrow(/does not match/);
    expect(store.requests.get(REQ)!.status).toBe("received");
  });

  it("model refusal / invalid output escalate and persist; infrastructure errors throw (job retries)", async () => {
    const a = new FakeRunStore();
    a.seed({ id: REQ, tenant_id: TENANT });
    expect(await runAndPersist(TENANT, REQ, OWNER, deps(throwingLlm(new LlmRefusalError("no", "cyber"))), a, AS_OF)).toMatchObject({ escalation_reason: "model_refused" });
    const b = new FakeRunStore();
    b.seed({ id: REQ, tenant_id: TENANT });
    expect(await runAndPersist(TENANT, REQ, OWNER, deps(throwingLlm(new LlmOutputError("bad"))), b, AS_OF)).toMatchObject({ escalation_reason: "model_output_invalid" });
    const c = new FakeRunStore();
    c.seed({ id: REQ, tenant_id: TENANT });
    await expect(runAndPersist(TENANT, REQ, OWNER, deps(throwingLlm(new Error("ECONNRESET"))), c, AS_OF)).rejects.toThrow(/ECONNRESET/);
    expect(c.requests.get(REQ)!.status).toBe("processing"); // same owner re-claims on retry
  });

  it("emits one structured run log line (spec §14) — provenance and counts, never email text or amounts", async () => {
    const store = new FakeRunStore();
    store.seed({ id: REQ, tenant_id: TENANT });
    const lines: unknown[] = [];
    await runAndPersist(TENANT, REQ, OWNER, { ...deps(pipelineLlm(SAMPLE_FCL_REQUEST)), log: (l) => lines.push(l) }, store, AS_OF);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ event: "quote_run", tenant_id: TENANT, request_id: REQ, owner: OWNER, decision: "quote", candidates: 1, presented: 1 });
    const line = lines[0] as { prompt_version: string; tariff_hashes: string[] };
    expect(line.prompt_version).toMatch(/^[0-9a-f]{12}$/);
    expect(line.tariff_hashes).toHaveLength(1);
    const text = JSON.stringify(lines[0]);
    expect(text).not.toContain("Rotterdam to New York"); // no email text
    expect(text).not.toMatch(/minor|"buy"|693000/); // no amounts
  });

  it("the validated extraction is persisted with the outcome", async () => {
    const seen: unknown[] = [];
    class SpyStore extends FakeRunStore {
      override async persistOutcome(requestId: string, tenantId: string, owner: string, o: PersistOutcome) {
        seen.push(o.extraction);
        return super.persistOutcome(requestId, tenantId, owner, o);
      }
    }
    const store = new SpyStore();
    store.seed({ id: REQ, tenant_id: TENANT });
    await runAndPersist(TENANT, REQ, OWNER, deps(pipelineLlm(SAMPLE_FCL_REQUEST)), store, AS_OF);
    expect(seen[0]).toMatchObject({ mode: "FCL", origin: { unlocode: "NLRTM" } });
  });
});
