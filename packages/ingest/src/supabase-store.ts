import { type SupabaseClient } from "@supabase/supabase-js";
import type { RateQuote } from "../../agents/src/schemas.js";
import { quoteToRow } from "../../agents/src/quote-store.js";
import type { IngestStore, ReceivedRequest } from "./poll.js";
import type { RunStore, RequestRow, UsageRecord } from "./run.js";

/**
 * Concrete service_role stores for the autonomous path (Phase 1C live, L1). The poll + durable run
 * execute as service_role, which BYPASSES RLS — so isolation is CODE-LEVEL: every method scopes to
 * the tenant_id it is given (P-TENANT), never to a policy. These are thin PostgREST adapters over the
 * interfaces proven hermetically (poll.test.ts / run.test.ts); their behaviour against the REAL DB is
 * proven by the live eval (evals/live-stores.ts).
 */

export class SupabaseIngestStore implements IngestStore {
  constructor(private readonly client: SupabaseClient) {}

  async getCursor(tenantId: string, mailbox: string): Promise<string> {
    const { data, error } = await this.client
      .from("poll_state")
      .select("cursor")
      .eq("tenant_id", tenantId)
      .eq("mailbox", mailbox)
      .maybeSingle();
    if (error) throw error;
    return (data?.cursor as string | undefined) ?? "1970-01-01T00:00:00Z";
  }

  async setCursor(tenantId: string, mailbox: string, cursor: string): Promise<void> {
    const { error } = await this.client
      .from("poll_state")
      .upsert(
        { tenant_id: tenantId, mailbox, cursor, updated_at: new Date().toISOString() },
        { onConflict: "tenant_id,mailbox" },
      );
    if (error) throw error;
  }

  async insertReceived(row: ReceivedRequest): Promise<string | null> {
    // Insert-once on the UNIQUE graph_message_id (on conflict do nothing): a fresh insert returns its
    // id; a dedup hit returns NO row -> null, which the poll counts as a duplicate (AC-1).
    const { data, error } = await this.client
      .from("quote_requests")
      .upsert(row, { onConflict: "graph_message_id", ignoreDuplicates: true })
      .select("id");
    if (error) throw error;
    const first = data?.[0];
    return first ? (first.id as string) : null;
  }

  async listReceived(tenantId: string): Promise<string[]> {
    const { data, error } = await this.client
      .from("quote_requests")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("status", "received");
    if (error) throw error;
    return (data ?? []).map((r) => r.id as string);
  }
}

export class SupabaseRunStore implements RunStore {
  constructor(private readonly client: SupabaseClient) {}

  async claim(tenantId: string, requestId: string): Promise<RequestRow | null> {
    // Atomic conditional UPDATE: received|processing -> processing, scoped to the tenant. A terminal
    // row (or a wrong tenant / missing id) matches nothing -> null. RETURNING gives the row to run.
    // ('processing' is claimable so a retried/crashed run re-runs; idempotency below keeps it safe.)
    const { data, error } = await this.client
      .from("quote_requests")
      .update({ status: "processing" })
      .eq("id", requestId)
      .eq("tenant_id", tenantId)
      .in("status", ["received", "processing"])
      .select("id, tenant_id, from_email, subject, body");
    if (error) throw error;
    const row = data?.[0];
    if (!row) return null;
    return {
      id: row.id as string,
      tenant_id: row.tenant_id as string,
      from_email: (row.from_email as string | null) ?? null,
      subject: (row.subject as string | null) ?? null,
      body: (row.body as string | null) ?? null,
    };
  }

  async saveQuote(requestId: string, tenantId: string, quote: RateQuote): Promise<void> {
    // Reuse the canonical RateQuote -> quotes mapping (immutable breakdown_snapshot, AC-4). Insert-once.
    const { error } = await this.client
      .from("quotes")
      .upsert(quoteToRow(requestId, tenantId, quote), { onConflict: "request_id", ignoreDuplicates: true });
    if (error) throw error;
  }

  async saveDraft(
    requestId: string,
    tenantId: string,
    draft: { subject: string; body: string },
  ): Promise<void> {
    const { error } = await this.client
      .from("drafts")
      .upsert(
        { request_id: requestId, tenant_id: tenantId, subject: draft.subject, body: draft.body },
        { onConflict: "request_id", ignoreDuplicates: true },
      );
    if (error) throw error;
  }

  async complete(
    requestId: string,
    tenantId: string,
    status: "awaiting_review" | "escalated",
    escalationReason: string | null,
    injectionFlag: boolean,
  ): Promise<void> {
    // First-writer-wins: only a row still in 'processing' transitions. A no-op otherwise — so a retry
    // whose first attempt already completed never flips a terminal outcome.
    const { error } = await this.client
      .from("quote_requests")
      .update({ status, escalation_reason: escalationReason, injection_flag: injectionFlag })
      .eq("id", requestId)
      .eq("tenant_id", tenantId)
      .eq("status", "processing");
    if (error) throw error;
  }

  async logUsage(
    requestId: string,
    tenantId: string,
    decision: "quote" | "escalate",
    usage: UsageRecord,
    injectionFlag: boolean,
  ): Promise<void> {
    const { error } = await this.client.from("audit_log").insert({
      tenant_id: tenantId,
      request_id: requestId,
      event: decision,
      model: usage.model,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      est_cost_usd: usage.est_cost_usd,
      injection_flag: injectionFlag,
    });
    if (error) throw error;
  }
}
