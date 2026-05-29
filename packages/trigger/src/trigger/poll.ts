import { schedules } from "@trigger.dev/sdk";
import { pollMailbox } from "../../../ingest/src/poll.js";
import { SupabaseIngestStore, createServiceClient } from "../../../ingest/src/supabase-store.js";
import { createStubMailbox } from "../../../ingest/src/stub-transport.js";
import { LINKPORT_TENANT_ID } from "../../../agents/src/index.js";
import { runRequestTask } from "./run.js";

const MAILBOX = "inbox";

/**
 * Scheduled poll (Phase 1C live, L2). Each cycle, for the configured tenant mailbox: read newer mail
 * via the REAL OutlookMailbox over the stub transport (createStubMailbox — swap for the live
 * client-credentials transport later, no other change), persist new mail as 'received' deduped by
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
  run: async () => {
    const tenantId = process.env.QUOTEAGENT_TENANT_ID ?? LINKPORT_TENANT_ID;
    const store = new SupabaseIngestStore(createServiceClient());
    const mailbox = createStubMailbox();

    const result = await pollMailbox(tenantId, MAILBOX, mailbox, store);

    if (result.toRun.length > 0) {
      await runRequestTask.batchTrigger(
        result.toRun.map((requestId) => ({
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
