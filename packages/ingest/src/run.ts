import { runAgentV2, type AgentDeps, type RunOptions } from "../../agents/src/pipeline/run.js";
import { quoteRowV2, type OutcomeDetailPublic, type QuoteRowV2 } from "../../agents/src/pipeline/output.js";
import type { Wire } from "../../core/src/pricing/wire.js";

/**
 * Durable agent-run for ONE request. The run is responsible for its OWN tenant safety, idempotency and
 * lease ownership — it does not trust a caller-supplied row:
 *
 *   1. CLAIM — claim_request (migration 0021) moves the request to 'processing' for THIS tenant and
 *      records `owner` (the Trigger run id, stable across retries of one run). It succeeds for
 *      'received', for 'processing' held by the same owner (a retry), or for a lease older than 70 min
 *      (a crashed run — stale steal). Another tenant, a missing id or a terminal request → no model call.
 *   2. RUN the v2 pipeline (extract → gate → tariff snapshot → price → guard → render).
 *   3. PERSIST atomically — persist_run_outcome: an owner-checked first statement (a stolen lease or a
 *      stale retry writes nothing), insert-once quote + draft + cost-confidential internals, outcome
 *      detail, usage + audit row. One transaction → a crash leaves no partial state.
 *
 * The autonomous path runs as service_role (RLS bypassed), so isolation is code-level: every store call
 * is scoped to `tenantId` and `owner`.
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
  est_cost_usd: number | null;
}

/** The run outcome to persist atomically. quote + draft are null on the escalate path. */
export interface PersistOutcome {
  status: "awaiting_review" | "escalated";
  escalationReason: string | null;
  injectionFlag: boolean;
  quote: QuoteRowV2 | null;
  draft: { subject: string; body: string } | null;
  usage: UsageRecord;
  /** What the model extracted (for reviewers/auditors); null when extraction did not happen. */
  extraction: unknown | null;
  /** Browser-safe outcome summary (reason, missing fields, option counts). */
  outcomeDetail: OutcomeDetailPublic;
  /** Full pricing result (costs, margins, all candidates, trace) — service_role-only table. */
  internals: Wire | null;
}

export interface RunStore {
  /** Atomically claim for THIS tenant and owner (see 1. above); null when not claimable. */
  claim(tenantId: string, requestId: string, owner: string): Promise<RequestRow | null>;
  /**
   * Persist the whole outcome in ONE transaction. Returns true iff THIS call (same owner) transitioned
   * the request; a retry-after-success or a run whose lease was stolen returns false and writes nothing.
   */
  persistOutcome(requestId: string, tenantId: string, owner: string, outcome: PersistOutcome): Promise<boolean>;
}

export type RunDeps = AgentDeps;

export type RunSummary =
  | { ran: false; reason: "not_claimable" }
  | {
      ran: true;
      decision: "quote" | "escalate";
      status: "awaiting_review" | "escalated";
      escalation_reason: string | null;
      injection_flag: boolean;
      /** Whether THIS run won the owner-checked transition. */
      transitioned: boolean;
    };

export async function runAndPersist(
  tenantId: string,
  requestId: string,
  owner: string,
  deps: RunDeps,
  store: RunStore,
  options: RunOptions = {},
): Promise<RunSummary> {
  if (deps.tenant.id !== tenantId) throw new Error(`tenant config ${deps.tenant.id} does not match request tenant ${tenantId}`);
  const request = await store.claim(tenantId, requestId, owner);
  if (!request) return { ran: false, reason: "not_claimable" };

  // Model refusals / invalid output escalate inside runAgentV2; anything thrown here is an
  // infrastructure fault and propagates so the durable job retries (same owner → re-claimable).
  const out = await runAgentV2({ from: request.from_email ?? "", subject: request.subject ?? "", body: request.body ?? "" }, deps, options);

  const status = out.decision === "quote" ? "awaiting_review" : "escalated";
  const transitioned = await store.persistOutcome(requestId, tenantId, owner, {
    status,
    escalationReason: out.escalation_reason,
    injectionFlag: out.injection_flag,
    quote: out.quote_view ? quoteRowV2(out.quote_view) : null,
    draft: out.draft,
    usage: out.usage,
    extraction: out.extraction,
    outcomeDetail: out.outcome,
    internals: out.pricing,
  });

  return { ran: true, decision: out.decision, status, escalation_reason: out.escalation_reason, injection_flag: out.injection_flag, transitioned };
}
