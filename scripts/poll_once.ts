import { pollMailbox } from "../packages/ingest/src/poll.js";
import { runAndPersist } from "../packages/ingest/src/run.js";
import {
  SupabaseIngestStore,
  SupabaseRunStore,
  createServiceClient,
} from "../packages/ingest/src/supabase-store.js";
import { createOutlookMailboxFromEnv, hasGraphEnv } from "../packages/graph/src/graph-transport.js";
import {
  AnthropicLlmClient,
  createSupabaseRateEngine,
  LINKPORT_TENANT_ID,
  DEFAULT_LANE,
} from "../packages/agents/src/index.js";

/**
 * Supervised one-shot of the scheduled poll — the in-process twin of the Trigger.dev `poll-mailbox`
 * task (packages/trigger/src/trigger/poll.ts). One cycle for the demo tenant mailbox: read mail newer
 * than the stored cursor from the LIVE Outlook folder via the project's own Graph transport, persist
 * each as a 'received' quote_request (deduped by graph_message_id, AC-1), advance the cursor, then run
 * the durable agent-run for each id in `toRun` (new ∪ stranded). Quotes/escalations land in Supabase →
 * the dashboard. Same code path the deployed poll uses; just run once, in-process, no worker.
 *
 * Requires GRAPH_* (live mailbox) + ANTHROPIC_API_KEY + Supabase service env.
 * Usage: npm run poll:once   (or: node --env-file=.env --import tsx scripts/poll_once.ts)
 */
const MAILBOX = "inbox";

async function main(): Promise<void> {
  if (!hasGraphEnv()) throw new Error("GRAPH_* env not set — cannot poll the live mailbox");
  const tenantId = process.env.QUOTEAGENT_TENANT_ID ?? LINKPORT_TENANT_ID;
  const supabase = createServiceClient();

  const result = await pollMailbox(tenantId, MAILBOX, createOutlookMailboxFromEnv(), new SupabaseIngestStore(supabase));
  console.log(
    `poll: inserted=${result.insertedIds.length} duplicates=${result.duplicates} ` +
      `reEnqueued=${result.reEnqueued.length} toRun=${result.toRun.length} cursor=${result.cursor}`,
  );

  const client = new AnthropicLlmClient();
  const engine = createSupabaseRateEngine(tenantId, DEFAULT_LANE);
  const store = new SupabaseRunStore(supabase);
  for (const requestId of result.toRun) {
    const summary = await runAndPersist(tenantId, requestId, { client, engine }, store);
    console.log(`run ${requestId}: ${JSON.stringify(summary)}`);
  }
  console.log(`done — ${result.toRun.length} request(s) processed. Refresh the dashboard.`);
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : JSON.stringify(e, null, 2));
  process.exit(1);
});
