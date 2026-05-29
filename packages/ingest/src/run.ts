import { runAgent } from "../../agents/src/agent.js";
import type { RateEngine } from "../../agents/src/rate-engine.js";
import type { LlmClient } from "../../agents/src/llm.js";
import { PER_STEP_ROUTING, type ModelRouting } from "../../agents/src/config.js";
import type { RateQuote } from "../../agents/src/schemas.js";

/**
 * Durable agent-run for ONE request (1C.2). Runs the Phase-0 pipeline (extract → gate → price →
 * draft → guard), then persists the outcome idempotently and tenant-scoped:
 *   - decision 'quote'    → insert-once quote + draft, request → 'awaiting_review';
 *   - decision 'escalate' → request → 'escalated' with its reason (no quote/draft);
 *   - both                → a usage row (observability, T13).
 * A Trigger.dev retry re-runs this body, but the quote/draft are insert-once on the UNIQUE
 * request_id, so a retry never duplicates them (P-1C.2). Every write carries the request's own
 * tenant_id — the autonomous path bypasses RLS, so isolation is code-level (P-TENANT).
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

/** Idempotent, tenant-scoped persistence for one run. saveQuote/saveDraft are insert-once on the
 *  UNIQUE request_id (P-1C.2); logUsage APPENDS (each invocation is recorded — T13). */
export interface RunStore {
  saveQuote(requestId: string, tenantId: string, quote: RateQuote): Promise<void>;
  saveDraft(requestId: string, tenantId: string, draft: { subject: string; body: string }): Promise<void>;
  setOutcome(
    requestId: string,
    tenantId: string,
    status: "awaiting_review" | "escalated",
    escalationReason: string | null,
    injectionFlag: boolean,
  ): Promise<void>;
  logUsage(
    requestId: string,
    tenantId: string,
    decision: "quote" | "escalate",
    usage: UsageRecord,
    injectionFlag: boolean,
  ): Promise<void>;
}

export interface RunDeps {
  client: LlmClient;
  engine: RateEngine;
  routing?: ModelRouting;
}

export interface RunSummary {
  decision: "quote" | "escalate";
  status: "awaiting_review" | "escalated";
  escalation_reason: string | null;
  injection_flag: boolean;
}

export async function runAndPersist(request: RequestRow, deps: RunDeps, store: RunStore): Promise<RunSummary> {
  const out = await runAgent(
    { from: request.from_email ?? "", subject: request.subject ?? "", body: request.body ?? "" },
    deps.client,
    deps.engine,
    deps.routing ?? PER_STEP_ROUTING,
  );

  const status = out.decision === "quote" ? "awaiting_review" : "escalated";

  // Insert-once quote + draft on the quote path (a retry leaves the originals untouched — P-1C.2 / AC-4).
  if (out.decision === "quote" && out.quote && out.draft) {
    await store.saveQuote(request.id, request.tenant_id, out.quote);
    await store.saveDraft(request.id, request.tenant_id, { subject: out.draft.subject, body: out.draft.body });
  }
  await store.setOutcome(request.id, request.tenant_id, status, out.escalation_reason, out.injection_flag);
  await store.logUsage(request.id, request.tenant_id, out.decision, out.usage, out.injection_flag);

  return { decision: out.decision, status, escalation_reason: out.escalation_reason, injection_flag: out.injection_flag };
}
