import { createServiceClient } from "../packages/ingest/src/supabase-store.js";
import { createOutlookSenderFromEnv, parseEmailAddress, hasGraphSendEnv } from "../packages/graph/src/graph-send.js";
import { LINKPORT_TENANT_ID } from "../packages/agents/src/index.js";

/**
 * Send-outbox worker (D-27). The TRUSTED half of the real-send loop: a human Approve claims a request
 * to 'sending' (approve_request RPC, dashboard); this worker — running as service_role with the Graph
 * app creds, NEVER the browser — picks up 'sending' rows, sends the drafted reply via Graph, then
 * finalizes: finalize_send(ok) -> 'sent' + real drafts.sent_at, or finalize_send(false) -> back to
 * 'awaiting_review' so a human can retry. Because finalize_send is service_role-only and the send is
 * gated on the exactly-once 'sending' claim, the "real send" record is non-forgeable and never doubles
 * (codex Gate-4 P1). Run once (npm run send:once) or on a schedule. Requires GRAPH_* + Supabase env.
 *
 * Usage: npm run send:once
 */
async function main(): Promise<void> {
  if (!hasGraphSendEnv()) throw new Error("GRAPH_* env not set — cannot send");
  const tenantId = process.env.QUOTEAGENT_TENANT_ID || LINKPORT_TENANT_ID;
  const supabase = createServiceClient();
  const sender = createOutlookSenderFromEnv();

  const { data, error } = await supabase
    .from("quote_requests")
    .select("id, from_email, drafts(subject, body)")
    .eq("tenant_id", tenantId)
    .eq("status", "sending");
  if (error) throw error;
  const rows = (data ?? []) as { id: string; from_email: string | null; drafts: { subject: string; body: string }[] | { subject: string; body: string } | null }[];
  if (rows.length === 0) {
    console.log("send-outbox: nothing in 'sending'.");
    return;
  }

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const draft = Array.isArray(row.drafts) ? row.drafts[0] : row.drafts;
    const to = row.from_email ? parseEmailAddress(row.from_email) : null;
    try {
      if (!to) throw new Error(`no valid recipient parsed from from_email=${row.from_email}`);
      if (!draft) throw new Error("no draft to send");
      await sender.sendReply(to, draft.subject, draft.body);
      const { error: finErr } = await supabase.rpc("finalize_send", { p_request_id: row.id, p_tenant_id: tenantId, p_ok: true });
      if (finErr) throw finErr;
      sent += 1;
      console.log(`sent ${row.id} -> ${to}`);
    } catch (e) {
      failed += 1;
      await supabase.rpc("finalize_send", { p_request_id: row.id, p_tenant_id: tenantId, p_ok: false });
      console.error(`send FAILED ${row.id}: ${e instanceof Error ? e.message : String(e)} — returned to awaiting_review`);
    }
  }
  console.log(`send-outbox: ${sent} sent, ${failed} failed (of ${rows.length}).`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
