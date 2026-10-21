import { task } from "@trigger.dev/sdk";
import { runAndPersist } from "../../../ingest/src/run.js";
import { SupabaseRunStore, createServiceClient } from "../../../ingest/src/supabase-store.js";
import {
  createLlmFromEnv,
  createSupabaseRateEngine,
  createKnowledgeRetrieverFromEnv,
} from "../../../agents/src/index.js";

/**
 * Durable agent-run for ONE request (Phase 1C live, L2). Wraps the idempotent runAndPersist (1C.2)
 * with the PRODUCTION deps: the env-configured LLM (any provider — createLlmFromEnv), the live
 * Supabase rate-card engine (resolves the active card by the request's tenant + mode + lane), the
 * scoped knowledge retriever (env-gated; ungrounded if unset), and the service_role SupabaseRunStore.
 * Demo mode is refused here: the autonomous path must never answer real mail from recordings.
 *
 * Enqueued by the poll task with concurrencyKey = requestId; queue concurrencyLimit 1 means no two
 * runs of the SAME request execute concurrently (D-22). The DB claim makes a retry after success a
 * no-op (not_claimable) — so Trigger.dev retries never double-bill the model or flip the outcome.
 *
 * onFailure (codex Gate-4 P2-c): once Trigger.dev exhausts retries, flip a still-'processing' row to
 * 'error' so it isn't stranded forever (the poll re-enqueues only 'received'). First-writer-safe.
 * markError is itself a Supabase call, so it is guarded — onFailure logs and never throws.
 */
export const runRequestTask = task({
  id: "run-request",
  queue: { concurrencyLimit: 1 },
  run: async (payload: { tenantId: string; requestId: string }) => {
    const { tenantId, requestId } = payload;
    const store = new SupabaseRunStore(createServiceClient());
    const llm = createLlmFromEnv();
    if (llm.mode === "demo") {
      throw new Error("run-request needs a live LLM provider (set ANTHROPIC_API_KEY or QUOTEAGENT_MODEL)");
    }
    const deps = {
      client: llm.client,
      routing: llm.routing,
      engine: createSupabaseRateEngine(tenantId),
      retriever: createKnowledgeRetrieverFromEnv(tenantId),
    };
    return await runAndPersist(tenantId, requestId, deps, store);
  },
  onFailure: async ({ payload }) => {
    // markError is a network call to Supabase — plausibly the SAME outage that failed the run. Never
    // throw from onFailure: log and return, so the failure handler itself cannot crash. (If markError
    // fails the row stays 'processing' — this log line is the operator's breadcrumb for that.)
    try {
      await new SupabaseRunStore(createServiceClient()).markError(payload.tenantId, payload.requestId);
    } catch (err) {
      console.error(
        `run-request onFailure: markError failed for ${payload.tenantId}/${payload.requestId}`,
        err,
      );
    }
  },
});
