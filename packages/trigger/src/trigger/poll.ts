import { schedules } from "@trigger.dev/sdk";
import { pollMailbox } from "../../../ingest/src/poll.js";
import { SupabaseIngestStore, createServiceClient } from "../../../ingest/src/supabase-store.js";
import { createStubMailbox } from "../../../ingest/src/stub-transport.js";
import { createOutlookMailboxFromEnv, GRAPH_ENV_KEYS, missingEnv } from "../../../graph/src/graph-transport.js";
import { LINKPORT_TENANT_ID } from "../../../agents/src/index.js";
import { runRequestTask } from "./run.js";

const MAILBOX = "inbox";

/** batchTrigger caps at 500 items per call — chunk well under it (see the enqueue loop below). */
const TRIGGER_BATCH_SIZE = 100;

/**
 * Resolve the mailbox to poll. The stub (fake fixture emails) is used ONLY on explicit opt-in
 * (QUOTEAGENT_ALLOW_STUB_MAILBOX=1) — NEVER as a silent fallback: a missing or typo'd GRAPH_* var
 * must be a loud failure, not fake data ingested into the real tenant (audit 2026-07). The error
 * names the missing keys, derived from GRAPH_ENV_KEYS so it cannot desync from the factory's check.
 */
function resolveMailbox() {
  if (process.env.QUOTEAGENT_ALLOW_STUB_MAILBOX === "1") return createStubMailbox();
  const missing = missingEnv(GRAPH_ENV_KEYS);
  if (missing.length > 0) {
    throw new Error(
      `poll-mailbox: live Graph env incomplete — missing ${missing.join(", ")}. ` +
        `Set the GRAPH_* vars, or set QUOTEAGENT_ALLOW_STUB_MAILBOX=1 to deliberately poll the stub corpus.`,
    );
  }
  return createOutlookMailboxFromEnv();
}

/**
 * Scheduled poll (Phase 1C live, L2). Each cycle, for the configured tenant mailbox: read newer mail
 * via the REAL OutlookMailbox over the live client-credentials transport (the deterministic stub only
 * on explicit opt-in — see resolveMailbox), persist new mail as 'received' deduped by
 * graph_message_id (AC-1), advance the per-tenant cursor, and enqueue the durable run for every id in
 * `toRun` (newly ingested ∪ stranded 'received' — W5 recovery). Each run is keyed by requestId, so a
 * re-enqueue of an in-flight request never runs it twice.
 *
 * Single-tenant for the demo (LINKPORT_TENANT_ID, env-overridable); a real deployment iterates a
 * mailboxes config table here, one poll per {tenant, mailbox}.
 */
export const pollMailboxTask = schedules.task({
  id: "poll-mailbox",
  cron: "*/5 * * * *", // every 5 minutes (UTC)
  // Serialize poll cycles (codex Gate-4 P2-d): never two poll runs at once, so they can't race on the
  // cursor. Belt-and-suspenders with the DB-monotonic advance_poll_cursor (greatest()) in setCursor.
  queue: { concurrencyLimit: 1 },
  run: async () => {
    const tenantId = process.env.QUOTEAGENT_TENANT_ID ?? LINKPORT_TENANT_ID;
    const store = new SupabaseIngestStore(createServiceClient());
    const mailbox = resolveMailbox();

    const result = await pollMailbox(tenantId, MAILBOX, mailbox, store);

    // Under backlog the W5 re-enqueue sweeps ALL stranded 'received', so toRun can exceed
    // batchTrigger's 500-item cap. Chunk to TRIGGER_BATCH_SIZE, sequentially: each chunk is
    // acknowledged before the next is sent, so a mid-poll crash loses at most the un-triggered tail —
    // recovered by the next cycle's stranded sweep.
    for (let i = 0; i < result.toRun.length; i += TRIGGER_BATCH_SIZE) {
      await runRequestTask.batchTrigger(
        result.toRun.slice(i, i + TRIGGER_BATCH_SIZE).map((requestId) => ({
          payload: { tenantId, requestId },
          options: { concurrencyKey: requestId },
        })),
      );
    }

    return {
      tenantId,
      inserted: result.insertedIds.length,
      duplicates: result.duplicates,
      reEnqueued: result.reEnqueued.length,
      triggered: result.toRun.length,
      cursor: result.cursor,
    };
  },
});
