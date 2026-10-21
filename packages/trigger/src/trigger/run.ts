import { logger, task } from "@trigger.dev/sdk";
import { runAndPersist } from "../../../ingest/src/run.js";
import { SupabaseRunStore, createServiceClient } from "../../../ingest/src/supabase-store.js";
import { createLlmFromEnv } from "../../../agents/src/index.js";
import { productionRunDeps } from "../../../ingest/src/production.js";

/**
 * Durable agent-run for ONE request. Wraps the idempotent runAndPersist with the PRODUCTION deps: the
 * env-configured LLM (any provider — createLlmFromEnv), the tenant's live rate cards through the
 * atomic get_rate_card RPC (SupabaseLegacyTariffSource), the tenant's configuration, and the
 * service_role SupabaseRunStore. Demo mode is refused: the autonomous path never answers real mail
 * from recordings.
 *
 * Lease ownership (spec §15.11): the Trigger run id is the owner token — stable across retries of ONE
 * run — so a retry re-claims its own row, a different run cannot while the lease (70 min, beyond the
 * 60-min maxDuration) is live, and a crashed run's row is stolen only after expiry (the poll re-enqueues
 * it). persist and markError are owner-checked: a run whose lease was stolen writes nothing.
 *
 * onFailure: once retries are exhausted, flip THIS owner's still-'processing' row to 'error'. markError
 * is itself a Supabase call, so it is guarded — onFailure logs and never throws.
 */
export const runRequestTask = task({
  id: "run-request",
  // One global queue: at most this many agent runs at once across all requests (a provider rate-limit
  // and spend bound). Per-request exclusion is the DB lease (claim_request), not the queue.
  queue: { concurrencyLimit: 4 },
  run: async (payload: { tenantId: string; requestId: string }, { ctx }) => {
    const { tenantId, requestId } = payload;
    const client = createServiceClient();
    const llm = createLlmFromEnv();
    if (llm.mode === "demo") {
      throw new Error("run-request needs a live LLM provider (set ANTHROPIC_API_KEY or QUOTEAGENT_MODEL)");
    }
    return await runAndPersist(tenantId, requestId, ctx.run.id, { ...productionRunDeps(client, tenantId, llm), log: (line) => logger.info("quote_run", { ...line }) }, new SupabaseRunStore(client));
  },
  onFailure: async ({ payload, ctx }) => {
    try {
      await new SupabaseRunStore(createServiceClient()).markError(payload.tenantId, payload.requestId, ctx.run.id);
    } catch (err) {
      console.error(`run-request onFailure: markError failed for ${payload.tenantId}/${payload.requestId}`, err);
    }
  },
});
