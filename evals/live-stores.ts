import { createClient } from "@supabase/supabase-js";
import { pollMailbox } from "../packages/ingest/src/poll.js";
import { runAndPersist } from "../packages/ingest/src/run.js";
import { SupabaseIngestStore, SupabaseRunStore } from "../packages/ingest/src/supabase-store.js";
import { createStubMailbox } from "../packages/ingest/src/stub-transport.js";
import { RoutingMockLlmClient } from "../packages/agents/src/mock-llm.js";
import { StaticCardRateEngine } from "../packages/agents/src/rate-engine.js";
import type { ExtractionResult } from "../packages/agents/src/schemas.js";

/**
 * Live proof of the concrete autonomous-path stores (Phase 1C live, L1 — npm run eval:live-stores).
 * The REAL SupabaseIngestStore + SupabaseRunStore run against the live `quoteagent` Supabase as
 * service_role, driven by a DETERMINISTIC mock LLM + StaticCardRateEngine (the agent logic is already
 * proven hermetically; this isolates the adapters' real-DB behaviour, and burns no Anthropic tokens —
 * the real-LLM end-to-end run is L3). Asserts the contract invariants the hermetic fakes stand in for:
 * AC-1 insert-once dedup, cursor round-trip, the durable run's claim/persist/complete, P-1C.2 retry
 * idempotency, and the P-TENANT claim gate. Idempotent seed + cleanup. Requires SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY.
 */

const url = process.env.SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!url || !serviceKey) {
  console.error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const T = "c1c10000-0000-4000-8000-0000000000a1"; // this eval's tenant
const TW = "d2d20000-0000-4000-8000-0000000000b2"; // a different tenant (claim-gate probe)
const MB = "inbox";
const QUOTABLE_GID = "stub-01-complete-40hc-x2";
const ESCALATE_GID = "stub-04-missing-container-type";

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
const escalateExtraction: ExtractionResult = { ...baseExtraction, container_type: "UNKNOWN", container_qty: null };

const routed = (extraction: ExtractionResult, draftBody = "all-in EUR 6,930.") =>
  new RoutingMockLlmClient({
    submit_extraction: { data: extraction, usage: { input_tokens: 300, output_tokens: 90 } },
    submit_draft: { data: { subject: "Re: Quote request", body: draftBody }, usage: { input_tokens: 250, output_tokens: 140 } },
  });
const deps = (client: RoutingMockLlmClient) => ({ client, engine: new StaticCardRateEngine() });

let pass = true;
const check = (label: string, ok: boolean): void => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) pass = false;
};
const countFor = async (table: string, requestId: string): Promise<number> => {
  const { count, error } = await admin.from(table).select("*", { count: "exact", head: true }).eq("request_id", requestId);
  if (error) throw error;
  return count ?? 0;
};

async function cleanup(): Promise<void> {
  await admin.from("audit_log").delete().in("tenant_id", [T, TW]);
  await admin.from("quotes").delete().in("tenant_id", [T, TW]);
  await admin.from("drafts").delete().in("tenant_id", [T, TW]);
  await admin.from("quote_requests").delete().in("tenant_id", [T, TW]);
  await admin.from("poll_state").delete().in("tenant_id", [T, TW]);
  await admin.from("tenants").delete().in("id", [T, TW]);
}

async function main(): Promise<void> {
  await cleanup(); // idempotent start
  await admin.from("tenants").upsert([
    { id: T, name: "Live Store Tenant" },
    { id: TW, name: "Other Tenant" },
  ]);

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
  const r1 = await runAndPersist(T, quotableId, deps(routed(baseExtraction)), runStore);
  check("run(quote): ran + decision quote + status awaiting_review", r1.ran === true && r1.decision === "quote" && r1.status === "awaiting_review");
  check("run(quote): atomic persist won the transition (transitioned=true)", r1.ran === true && r1.transitioned === true);
  const { data: q } = await admin.from("quotes").select("all_in_total").eq("request_id", quotableId).single();
  check("quote row persisted with all_in_total 6930 (snapshot)", (q?.all_in_total as number | undefined) === 6930);
  check("draft row persisted", (await countFor("drafts", quotableId)) === 1);
  const { data: qr1 } = await admin.from("quote_requests").select("status").eq("id", quotableId).single();
  check("request advanced to awaiting_review", qr1?.status === "awaiting_review");
  check("exactly one usage row logged (quote)", (await countFor("audit_log", quotableId)) === 1);

  // ── retry idempotency (P-1C.2, live) ──
  const retryClient = routed(baseExtraction);
  const r1b = await runAndPersist(T, quotableId, deps(retryClient), runStore);
  check("retry after success: not_claimable (terminal)", r1b.ran === false);
  check("retry did NOT re-invoke the model (no re-bill, no flip)", retryClient.calls.length === 0);
  check("still exactly one quote / one draft / one usage row", (await countFor("quotes", quotableId)) === 1 && (await countFor("drafts", quotableId)) === 1 && (await countFor("audit_log", quotableId)) === 1);

  // ── escalate path ──
  console.log("SupabaseRunStore — escalate path");
  const r2 = await runAndPersist(T, escalateId, deps(routed(escalateExtraction)), runStore);
  check("run(escalate): escalated + reason missing_required_field", r2.ran === true && r2.decision === "escalate" && r2.status === "escalated" && r2.escalation_reason === "missing_required_field");
  check("no quote and no draft on the escalate path", (await countFor("quotes", escalateId)) === 0 && (await countFor("drafts", escalateId)) === 0);
  const { data: qr2 } = await admin.from("quote_requests").select("status").eq("id", escalateId).single();
  check("request advanced to escalated", qr2?.status === "escalated");
  check("escalate path still logs one usage row (T13 parity)", (await countFor("audit_log", escalateId)) === 1);

  // ── P-TENANT claim gate (live): the WRONG tenant claims nothing — no model call, status unchanged ──
  console.log("P-TENANT claim gate");
  const wrongClient = routed(baseExtraction);
  const r3 = await runAndPersist(TW, id1 as string, deps(wrongClient), runStore); // id1 is a 'received' row owned by T
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
