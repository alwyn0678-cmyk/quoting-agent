import { runAgent } from "../../agents/src/agent.js";
import type { RateEngine } from "../../agents/src/rate-engine.js";
import type { LlmClient } from "../../agents/src/llm.js";
import { PER_STEP_ROUTING, type ModelRouting } from "../../agents/src/config.js";
import type { RateQuote } from "../../agents/src/schemas.js";

/**
 * Durable agent-run for ONE request (1C.2). The run is responsible for its OWN tenant safety and
 * idempotency — it does not trust a caller-supplied row (codex Gate-4 #1):
 *
 *   1. CLAIM — load the request scoped to (tenantId, requestId) and move 'received' -> 'processing'.
 *      Refuses (no model call, no writes) for another tenant, a missing id, or an ALREADY-TERMINAL
 *      request. This is the tenant gate (P-TENANT) AND the idempotency gate: a Trigger.dev retry
 *      after success re-runs nothing, so the LLM outcome can't flip awaiting_review<->escalated (#2).
 *   2. RUN the Phase-0 pipeline (extract -> gate -> price -> draft -> guard).
 *   3. PERSIST atomically — ONE RPC (persist_run_outcome, migration 0009) inserts-once quote + draft
 *      (UNIQUE request_id — P-1C.2), flips 'processing' -> terminal (first-writer-wins), and logs usage
 *      on the winning transition. One transaction → a crash leaves no partial state (codex Gate-4 P1-b).
 *
 * The autonomous path runs as service_role (RLS bypassed), so isolation is code-level: every store
 * call is scoped to `tenantId` (P-TENANT). Claiming via 'processing' also keeps the poll (1C.1) from
 * re-enqueuing an in-flight run (#3); crash recovery of a stuck 'processing' row is the live layer's
 * job (a claimed_at lease + Trigger.dev concurrency key — see DECISION_LOG).
 */

export interface RequestRow {
  id: string;
  tenant_id: string;
  from_email: string | null;
  subject: string | null;
  body: string | null;
}

export interface UsageRecord {
  model: string;
  input_tokens: number;
  output_tokens: number;
  est_cost_usd: number;
}

/** The run outcome to persist atomically. quote + draft are null on the escalate path. */
export interface PersistOutcome {
  status: "awaiting_review" | "escalated";
  escalationReason: string | null;
  injectionFlag: boolean;
  quote: RateQuote | null;
  draft: { subject: string; body: string } | null;
  usage: UsageRecord;
}

export interface RunStore {
  /**
   * Atomically claim a request for THIS tenant: return it and move 'received' -> 'processing' iff it
   * belongs to `tenantId` and is claimable ('received', or 'processing' for a retried/crashed run).
   * Return null for another tenant, a missing id, or an already-terminal request.
   */
  claim(tenantId: string, requestId: string): Promise<RequestRow | null>;
  /**
   * Persist the whole outcome in ONE transaction (codex Gate-4 P1-b): insert-once quote + draft, flip
   * 'processing' -> terminal (first-writer-wins), and log usage on the winning transition. Returns true
   * iff THIS call transitioned the request — a retry-after-success returns false and writes nothing new.
   * Because it is atomic, a crash can never leave an orphaned quote/draft or a terminal row without usage.
   */
  persistOutcome(requestId: string, tenantId: string, outcome: PersistOutcome): Promise<boolean>;
}

export interface RunDeps {
  client: LlmClient;
  engine: RateEngine;
  routing?: ModelRouting;
}

export type RunSummary =
  | { ran: false; reason: "not_claimable" }
  | {
      ran: true;
      decision: "quote" | "escalate";
      status: "awaiting_review" | "escalated";
      escalation_reason: string | null;
      injection_flag: boolean;
      /** Whether THIS run won the first-writer transition (false if a concurrent/earlier run already did). */
      transitioned: boolean;
    };

export async function runAndPersist(
  tenantId: string,
  requestId: string,
  deps: RunDeps,
  store: RunStore,
): Promise<RunSummary> {
  const request = await store.claim(tenantId, requestId);
  if (!request) return { ran: false, reason: "not_claimable" };

  const out = await runAgent(
    { from: request.from_email ?? "", subject: request.subject ?? "", body: request.body ?? "" },
    deps.client,
    deps.engine,
    deps.routing ?? PER_STEP_ROUTING,
  );

  const status = out.decision === "quote" ? "awaiting_review" : "escalated";
  const transitioned = await store.persistOutcome(requestId, tenantId, {
    status,
    escalationReason: out.escalation_reason,
    injectionFlag: out.injection_flag,
    quote: out.decision === "quote" ? out.quote : null,
    draft: out.decision === "quote" && out.draft ? { subject: out.draft.subject, body: out.draft.body } : null,
    usage: out.usage,
  });

  return { ran: true, decision: out.decision, status, escalation_reason: out.escalation_reason, injection_flag: out.injection_flag, transitioned };
}
