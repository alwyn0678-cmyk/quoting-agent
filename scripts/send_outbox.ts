import { createServiceClient } from "../packages/ingest/src/supabase-store.js";
import { createOutlookSenderFromEnv, parseEmailAddress, hasGraphSendEnv } from "../packages/graph/src/graph-send.js";
import { LINKPORT_TENANT_ID } from "../packages/agents/src/index.js";

/**
 * Send-outbox worker (D-27). The TRUSTED half of the real-send loop: a human Approve claims a request
 * to 'sending' (approve_request RPC, dashboard); this worker — running as service_role with the Graph
 * app creds, NEVER the browser — sends the drafted reply and finalizes. Properties (codex Gate-4 R2):
 *   - EXACTLY-ONCE under concurrency: claim_for_send atomically leases UNCLAIMED 'sending' rows
 *     (FOR UPDATE SKIP LOCKED), so two workers never send the same row.
 *   - SAFE on crash: a claimed row is never auto-reclaimed; a crash after the Graph send leaves it
 *     claimed-'sending' for manual reconciliation rather than risking a re-send (at-most-once on crash).
 *   - finalize_send (service_role ONLY) records the real, non-forgeable drafts.sent_at on success, or
 *     returns a PROVEN pre-send failure to 'awaiting_review'. An AMBIGUOUS send failure (the Graph call
 *     threw — it may have gone through) is NOT requeued; it is left claimed + logged loudly.
 * Run once (npm run send:once) or on a schedule. Requires GRAPH_* + Supabase service env.
 */
async function main(): Promise<void> {
  if (!hasGraphSendEnv()) throw new Error("GRAPH_* env not set — cannot send");
  const tenantId = process.env.QUOTEAGENT_TENANT_ID || LINKPORT_TENANT_ID;
  const supabase = createServiceClient();
  const sender = createOutlookSenderFromEnv();

  // Atomic claim — only THIS worker now owns these rows for the send.
  const { data, error } = await supabase.rpc("claim_for_send", { p_tenant_id: tenantId });
  if (error) throw error;
  const rows = (data ?? []) as { request_id: string; from_email: string | null; subject: string; body: string }[];
  if (rows.length === 0) {
    console.log("send-outbox: nothing claimable in 'sending'.");
    return;
  }

  let sent = 0;
  let preSendFailed = 0;
  let stuck = 0;
  for (const row of rows) {
    const to = row.from_email ? parseEmailAddress(row.from_email) : null;
    if (!to) {
      // PROVEN no-send (no valid recipient) → safe to return to awaiting_review for human retry.
      const { error: finErr } = await supabase.rpc("finalize_send", { p_request_id: row.request_id, p_tenant_id: tenantId, p_ok: false });
      if (finErr) { console.error(`finalize(false) FAILED ${row.request_id}: ${finErr.message} — row may be stuck in 'sending'`); stuck += 1; }
      else { preSendFailed += 1; console.error(`no valid recipient for ${row.request_id} (from=${row.from_email}) — returned to awaiting_review`); }
      continue;
    }
    try {
      await sender.sendReply(to, row.subject, row.body);
    } catch (e) {
      // AMBIGUOUS: the Graph call threw — the mail MAY have been accepted. Do NOT requeue (would risk a
      // double-send). Leave it claimed-'sending' for manual reconciliation; surface loudly.
      stuck += 1;
      console.error(`send AMBIGUOUS-FAILED ${row.request_id} -> ${to}: ${e instanceof Error ? e.message : String(e)} — left claimed in 'sending' for manual reconcile (NOT requeued)`);
      continue;
    }
    // Sent OK → finalize to 'sent' + real sent_at. If THIS write fails, the row stays claimed-'sending'
    // (never resent), so the worst case is a sent email shown as 'sending' until reconciled — never a
    // double send.
    const { error: finErr } = await supabase.rpc("finalize_send", { p_request_id: row.request_id, p_tenant_id: tenantId, p_ok: true });
    if (finErr) { console.error(`SENT but finalize(true) FAILED ${row.request_id}: ${finErr.message} — left claimed in 'sending' (no resend); reconcile manually`); stuck += 1; continue; }
    sent += 1;
    console.log(`sent ${row.request_id} -> ${to}`);
  }
  console.log(`send-outbox: ${sent} sent, ${preSendFailed} returned-to-review, ${stuck} stuck/needs-reconcile (of ${rows.length}).`);
  process.exit(stuck > 0 ? 1 : 0);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
