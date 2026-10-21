import { createClient } from "@supabase/supabase-js";
import { pollMailbox } from "../packages/ingest/src/poll.js";
import { runAndPersist } from "../packages/ingest/src/run.js";
import { SupabaseIngestStore, SupabaseRunStore } from "../packages/ingest/src/supabase-store.js";
import { createStubMailbox } from "../packages/ingest/src/stub-transport.js";
import { legacyStaticSource } from "../packages/agents/src/sources/tariff-source.js";
import { legacyTenantConfig } from "../packages/agents/src/pipeline/tenant.js";
import { pipelineLlm, SAMPLE_FCL_REQUEST } from "../packages/agents/src/pipeline/testing.js";
import type { RoutingMockLlmClient } from "../packages/agents/src/mock-llm.js";

/**
 * Live proof of the concrete autonomous-path stores (Phase 1C live, L1 — npm run eval:live-stores).
 * The REAL SupabaseIngestStore + SupabaseRunStore run against the live `quoteagent` Supabase as
 * service_role, driven by a DETERMINISTIC mock LLM + the static legacy tariff (the agent logic is already
 * proven hermetically; this isolates the adapters' real-DB behaviour, and burns no Anthropic tokens —
 * the real-LLM end-to-end run is L3). Asserts the contract invariants the hermetic fakes stand in for:
 * AC-1 insert-once dedup, cursor round-trip, the durable run's owner-checked claim/persist (v2 quote,
 * internals, outcome detail), P-1C.2 retry idempotency, lease ownership and the P-TENANT claim gate. Idempotent seed + cleanup. Requires SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY.
 */

const url = process.env.SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!url || !serviceKey) {
  console.error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

/** supabase-js never throws — fail LOUDLY with context instead of ignoring a returned error. */
function must<T extends { error: unknown }>(res: T, what: string): T {
  if (res.error) throw new Error(`${what} failed: ${res.error instanceof Error ? res.error.message : JSON.stringify(res.error)}`);
  return res;
}

const T = "c1c10000-0000-4000-8000-0000000000a1"; // this eval's tenant
const TW = "d2d20000-0000-4000-8000-0000000000b2"; // a different tenant (claim-gate probe)
const MB = "inbox";
const QUOTABLE_GID = "stub-01-complete-40hc-x2";
const ESCALATE_GID = "stub-04-missing-container-type";

const escalateRequest = { ...SAMPLE_FCL_REQUEST, cargo: { ...SAMPLE_FCL_REQUEST.cargo, containers: [] } };
const AS_OF = { asOf: "2026-06-01" };
const deps = (llm: RoutingMockLlmClient, tenantId = T) => ({ llm, tariffs: legacyStaticSource(tenantId), tenant: legacyTenantConfig(tenantId) });
const OWNER = "live-stores-run";

let pass = true;
const check = (label: string, ok: boolean): void => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) pass = false;
};
const countFor = async (table: string, requestId: string): Promise<number> => {
  let q = admin.from(table).select("*", { count: "exact", head: true }).eq("request_id", requestId);
  // audit_log also carries one 'transition' row per status change (trigger, migration 0019); the
  // usage rows these checks count are the run outcome events.
  if (table === "audit_log") q = q.in("event", ["quote", "escalate"]);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
};

async function cleanup(): Promise<void> {
  must(await admin.from("audit_log").delete().in("tenant_id", [T, TW]), "cleanup audit_log");
  must(await admin.from("quote_internals").delete().in("tenant_id", [T, TW]), "cleanup quote_internals");
  must(await admin.from("quotes").delete().in("tenant_id", [T, TW]), "cleanup quotes");
  must(await admin.from("drafts").delete().in("tenant_id", [T, TW]), "cleanup drafts");
  must(await admin.from("quote_requests").delete().in("tenant_id", [T, TW]), "cleanup quote_requests");
  must(await admin.from("poll_state").delete().in("tenant_id", [T, TW]), "cleanup poll_state");
  must(await admin.from("tenants").delete().in("id", [T, TW]), "cleanup tenants");
}

async function main(): Promise<void> {
  await cleanup(); // idempotent start
  must(
    await admin.from("tenants").upsert([
      { id: T, name: "Live Store Tenant" },
      { id: TW, name: "Other Tenant" },
    ]),
    "seed tenants",
  );

  const ingest = new SupabaseIngestStore(admin);
  const runStore = new SupabaseRunStore(admin);

  // ── SupabaseIngestStore: insert-once dedup via the adapter (AC-1, live) ──
  console.log("SupabaseIngestStore");
  const probe = { tenant_id: T, source: "poll" as const, graph_message_id: "live-dedup-probe", from_email: "x@y.example", subject: "s", body: "b", status: "received" as const };
  const id1 = await ingest.insertReceived(probe);
  const id2 = await ingest.insertReceived(probe);
  check("insertReceived: first insert returns an id", typeof id1 === "string" && !!id1);
  check("insertReceived: duplicate graph_message_id returns null (dedup)", id2 === null);

  // P1-a (codex Gate-4): dedup is TENANT-SCOPED — two tenants may share a graph_message_id, each its own row.
  const sharedA = await ingest.insertReceived({ tenant_id: T, source: "poll", graph_message_id: "shared-gid", from_email: "a@x.example", subject: "s", body: "b", status: "received" });
  const sharedB = await ingest.insertReceived({ tenant_id: TW, source: "poll", graph_message_id: "shared-gid", from_email: "b@x.example", subject: "s", body: "b", status: "received" });
  check("dedup is tenant-scoped: two tenants share a graph_message_id, both get rows (P1-a)", typeof sharedA === "string" && typeof sharedB === "string" && sharedA !== sharedB);

  // ── cursor round-trip through poll_state ──
  await ingest.setCursor(T, MB, "2026-01-01T00:00:00Z");
  check("cursor round-trips through poll_state", (await ingest.getCursor(T, MB)) === "2026-01-01T00:00:00Z");
  await ingest.setCursor(T, MB, "1970-01-01T00:00:00Z"); // reset so the poll below sees the corpus

  // ── the real poll over the stub mailbox ──
  const mailbox = createStubMailbox();
  const p1 = await pollMailbox(T, MB, mailbox, ingest);
  check("poll cycle 1 ingests both corpus emails", p1.insertedIds.length === 2);
  check("poll advances cursor to latest receivedDateTime", p1.cursor === "2026-05-28T09:05:00Z");
  const p2 = await pollMailbox(T, MB, mailbox, ingest);
  check("poll cycle 2 ingests nothing new (stub honors the cursor)", p2.insertedIds.length === 0 && p2.duplicates === 0);

  const { data: reqs, error: reqErr } = await admin
    .from("quote_requests")
    .select("id, graph_message_id")
    .eq("tenant_id", T)
    .in("graph_message_id", [QUOTABLE_GID, ESCALATE_GID]);
  if (reqErr) throw reqErr;
  const quotableId = reqs?.find((r) => r.graph_message_id === QUOTABLE_GID)?.id as string;
  const escalateId = reqs?.find((r) => r.graph_message_id === ESCALATE_GID)?.id as string;

  // ── SupabaseRunStore: quote path (durable run, live DB, deterministic LLM) ──
  console.log("SupabaseRunStore — quote path");
  const r1 = await runAndPersist(T, quotableId, OWNER, deps(pipelineLlm(SAMPLE_FCL_REQUEST)), runStore, AS_OF);
  check("run(quote): ran + decision quote + status awaiting_review", r1.ran === true && r1.decision === "quote" && r1.status === "awaiting_review");
  check("run(quote): atomic persist won the transition (transitioned=true)", r1.ran === true && r1.transitioned === true);
  const { data: q } = await admin.from("quotes").select("quote_version, currency, total_minor, option_count").eq("request_id", quotableId).single();
  check("v2 quote row persisted: EUR 693000 minor, 1 option", q?.quote_version === 2 && q?.currency === "EUR" && String(q?.total_minor) === "693000" && q?.option_count === 1);
  check("cost-confidential internals row persisted (service_role table)", (await countFor("quote_internals", quotableId)) === 1);
  check("draft row persisted", (await countFor("drafts", quotableId)) === 1);
  const { data: qr1 } = await admin.from("quote_requests").select("status, claim_owner, outcome_detail").eq("id", quotableId).single();
  check("request advanced to awaiting_review, owned by this run, with a public outcome", qr1?.status === "awaiting_review" && qr1?.claim_owner === OWNER && (qr1?.outcome_detail as { options_presented?: number } | null)?.options_presented === 1);
  check("exactly one usage row logged (quote)", (await countFor("audit_log", quotableId)) === 1);

  // ── retry idempotency (P-1C.2, live) ──
  const retryClient = pipelineLlm(SAMPLE_FCL_REQUEST);
  const r1b = await runAndPersist(T, quotableId, OWNER, deps(retryClient), runStore, AS_OF);
  check("retry after success: not_claimable (terminal)", r1b.ran === false);
  check("retry did NOT re-invoke the model (no re-bill, no flip)", retryClient.calls.length === 0);
  check("still exactly one quote / one draft / one usage row", (await countFor("quotes", quotableId)) === 1 && (await countFor("drafts", quotableId)) === 1 && (await countFor("audit_log", quotableId)) === 1);

  // ── escalate path ──
  console.log("SupabaseRunStore — escalate path");
  // Lease ownership (live): another owner cannot take a live lease; persist under a foreign owner is a no-op.
  console.log("Lease ownership");
  const held = await runStore.claim(T, escalateId, "owner-a");
  const stolen = await runStore.claim(T, escalateId, "owner-b");
  check("claim records the owner; a second owner cannot take a live lease", held !== null && stolen === null);
  const foreign = await runStore.persistOutcome(escalateId, T, "owner-b", {
    status: "escalated", escalationReason: "low_confidence", injectionFlag: false, quote: null, draft: null,
    usage: { model: "none", input_tokens: 0, output_tokens: 0, est_cost_usd: 0 }, extraction: null,
    outcomeDetail: { reason: "low_confidence", missing_fields: [], options_presented: 0, candidates: 0 }, internals: null,
  });
  check("persist under a foreign owner writes nothing", foreign === false && (await countFor("audit_log", escalateId)) === 0);
  check("markError under a foreign owner is a no-op", (await runStore.markError(T, escalateId, "owner-b")) === false);

  const r2 = await runAndPersist(T, escalateId, "owner-a", deps(pipelineLlm(escalateRequest)), runStore, AS_OF);
  check("run(escalate): escalated + reason missing_required_field", r2.ran === true && r2.decision === "escalate" && r2.status === "escalated" && r2.escalation_reason === "missing_required_field");
  check("no quote and no draft on the escalate path", (await countFor("quotes", escalateId)) === 0 && (await countFor("drafts", escalateId)) === 0);
  const { data: qr2 } = await admin.from("quote_requests").select("status").eq("id", escalateId).single();
  check("request advanced to escalated", qr2?.status === "escalated");
  check("escalate path still logs one usage row (T13 parity)", (await countFor("audit_log", escalateId)) === 1);

  // ── P-TENANT claim gate (live): the WRONG tenant claims nothing — no model call, status unchanged ──
  console.log("P-TENANT claim gate");
  const wrongClient = pipelineLlm(SAMPLE_FCL_REQUEST);
  const r3 = await runAndPersist(TW, id1 as string, OWNER, deps(wrongClient, TW), runStore, AS_OF); // id1 is a 'received' row owned by T
  const { data: qr3 } = await admin.from("quote_requests").select("status").eq("id", id1 as string).single();
  check("wrong-tenant run is not_claimable, model not called, row untouched", r3.ran === false && wrongClient.calls.length === 0 && qr3?.status === "received");

  await cleanup();
  console.log(`\nP-1C(L1) live stores: ${pass ? "PASS" : "FAIL"}`);
  process.exit(pass ? 0 : 1);
}

main().catch(async (e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  try {
    await cleanup();
  } catch {
    /* best effort */
  }
  process.exit(1);
});
