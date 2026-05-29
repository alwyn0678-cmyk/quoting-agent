import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { quoteToRow } from "../../agents/src/quote-store.js";
import type { IngestStore, ReceivedRequest } from "./poll.js";
import type { RunStore, RequestRow, PersistOutcome } from "./run.js";

/**
 * Concrete service_role stores for the autonomous path (Phase 1C live, L1). The poll + durable run
 * execute as service_role, which BYPASSES RLS — so isolation is CODE-LEVEL: every method scopes to
 * the tenant_id it is given (P-TENANT), never to a policy. These are thin PostgREST adapters over the
 * interfaces proven hermetically (poll.test.ts / run.test.ts); their behaviour against the REAL DB is
 * proven by the live eval (evals/live-stores.ts).
 */

/** Build a service_role client from env (server-side ONLY — bypasses RLS; never ships to a browser).
 *  Mirrors createSupabaseRateEngine's env handling; used by the autonomous poll + run tasks (1C live). */
export function createServiceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required for the service_role stores");
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

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
    // DB-monotonic advance (codex Gate-4 P2-d): the RPC sets cursor = greatest(existing, new), so an
    // overlapping or late poll can never regress it. ISO-8601 sorts lexicographically = chronologically.
    const { error } = await this.client.rpc("advance_poll_cursor", {
      p_tenant_id: tenantId,
      p_mailbox: mailbox,
      p_cursor: cursor,
    });
    if (error) throw error;
  }

  async insertReceived(row: ReceivedRequest): Promise<string | null> {
    // Insert-once on the UNIQUE (tenant_id, graph_message_id) (on conflict do nothing): a fresh insert
    // returns its id; a dedup hit returns NO row -> null, counted as a duplicate (AC-1). The key is
    // tenant-scoped (migration 0008, codex Gate-4 P1-a) so one tenant never drops another's message.
    const { data, error } = await this.client
      .from("quote_requests")
      .upsert(row, { onConflict: "tenant_id,graph_message_id", ignoreDuplicates: true })
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

  async persistOutcome(requestId: string, tenantId: string, o: PersistOutcome): Promise<boolean> {
    // One atomic txn (persist_run_outcome, migration 0009 — codex Gate-4 P1-b): insert-once quote +
    // draft (immutable snapshot via the canonical quoteToRow, AC-4), first-writer status flip, and the
    // usage row logged on the winning transition. Returns whether THIS call won the transition.
    const { data, error } = await this.client.rpc("persist_run_outcome", {
      p_request_id: requestId,
      p_tenant_id: tenantId,
      p_status: o.status,
      p_escalation_reason: o.escalationReason,
      p_injection_flag: o.injectionFlag,
      p_quote: o.quote ? quoteToRow(requestId, tenantId, o.quote) : null,
      p_draft: o.draft ? { subject: o.draft.subject, body: o.draft.body } : null,
      p_usage: {
        model: o.usage.model,
        input_tokens: o.usage.input_tokens,
        output_tokens: o.usage.output_tokens,
        est_cost_usd: o.usage.est_cost_usd,
      },
    });
    if (error) throw error;
    return Boolean(data);
  }

  /** Mark a stuck 'processing' run as 'error' after Trigger.dev exhausts retries (codex Gate-4 P2-c).
   *  First-writer-safe: only flips a row still 'processing', never clobbers a terminal outcome. Not on
   *  the RunStore interface — it's the run task's onFailure hook, not part of the happy-path run. */
  async markError(tenantId: string, requestId: string): Promise<void> {
    const { error } = await this.client
      .from("quote_requests")
      .update({ status: "error" })
      .eq("id", requestId)
      .eq("tenant_id", tenantId)
      .eq("status", "processing");
    if (error) throw error;
  }
}
