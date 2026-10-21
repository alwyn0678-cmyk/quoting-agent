import type { InboundMessage } from "../../graph/src/outlook.js";

/**
 * Scheduled-poll logic (1C.1). One cycle for ONE tenant mailbox: read the stored cursor, list mail
 * newer than it (OutlookMailbox.listSince), persist each message as a 'received' quote_request —
 * de-duplicated by the UNIQUE graph_message_id so the same message polled twice yields exactly one
 * request (AC-1) — advance the cursor, then surface the 'received' requests to (re-)enqueue an
 * agent-run for (AUTONOMY W5: stranded received are recovered, not lost).
 *
 * The autonomous path runs as service_role, which BYPASSES RLS — so tenant isolation here is
 * CODE-LEVEL: every store call is explicitly scoped to `tenantId` (P-TENANT), never left to RLS.
 * Triggering the durable agent-run for `toRun` is the caller's job (the Trigger.dev task, 1C.2);
 * that run is idempotent, so re-enqueuing an in-flight request is harmless.
 */

/** A claimed run older than this is presumed crashed and may be re-claimed (claim_request default;
 *  beyond the run task's 60-minute max duration). */
export const LEASE_MINUTES = 70;

/** A new message to persist. graph_message_id is UNIQUE → the dedup key. */
export interface ReceivedRequest {
  tenant_id: string;
  source: "poll";
  graph_message_id: string;
  from_email: string;
  subject: string;
  body: string;
  status: "received";
}

/** The narrow persistence the poll needs. Every method is tenant-scoped by argument (P-TENANT). */
export interface IngestStore {
  getCursor(tenantId: string, mailbox: string): Promise<string>;
  setCursor(tenantId: string, mailbox: string, cursor: string): Promise<void>;
  /** Insert a received request; dedup on the UNIQUE graph_message_id. Returns the new request id, or
   *  null if a request for that graph_message_id already existed (the dedup hit — AC-1). */
  insertReceived(row: ReceivedRequest): Promise<string | null>;
  /** Requests to (re-)run for THIS tenant: 'received', or 'processing' with an expired lease. */
  listRunnable(tenantId: string): Promise<RunnableRequest[]>;
}

export interface RunnableRequest {
  id: string;
  /** The current lease's claim time (null for a never-claimed or requeued request). */
  claimed_at: string | null;
}

/**
 * Enqueue idempotency key for one run attempt: the request plus its current lease. A re-poll while a
 * run is queued or in flight reuses the key (deduplicated by Trigger.dev within its TTL), while a
 * crashed run's expired lease yields a new key, so recovery is never blocked.
 */
export function enqueueKey(r: RunnableRequest): string {
  return `run-request:${r.id}:${r.claimed_at ?? "unclaimed"}`;
}

/** Just the read half of OutlookMailbox the poll uses (structural — real wrapper + fakes satisfy it). */
export interface MailboxReader {
  listSince(cursor: string): Promise<{ messages: InboundMessage[]; cursor: string }>;
}

export interface PollResult {
  insertedIds: string[]; // request ids newly ingested this cycle
  duplicates: number; // messages already seen (dedup hits — AC-1)
  cursor: string; // advanced cursor
  reEnqueued: string[]; // pre-existing stranded request ids (W5 + expired leases)
  toRun: string[]; // the set to trigger an agent-run for: new ∪ stranded
  /** One idempotency key per id in toRun (enqueueKey). */
  enqueueKeys: Record<string, string>;
}

export async function pollMailbox(
  tenantId: string,
  mailbox: string,
  reader: MailboxReader,
  store: IngestStore,
): Promise<PollResult> {
  const cursor = await store.getCursor(tenantId, mailbox);
  const { messages } = await reader.listSince(cursor);

  // Advance the cursor ONLY to the latest receivedDateTime actually seen, never backward — robust to a
  // stale or unsorted page (a non-monotonic cursor would silently skip mail). ISO-8601 sorts
  // lexicographically = chronologically, so a string compare is a time compare here.
  let next = cursor;
  for (const m of messages) if (m.receivedDateTime > next) next = m.receivedDateTime;

  const insertedIds: string[] = [];
  let duplicates = 0;
  for (const m of messages) {
    const id = await store.insertReceived({
      tenant_id: tenantId,
      source: "poll",
      graph_message_id: m.id,
      from_email: m.from,
      subject: m.subject,
      body: m.body,
      status: "received",
    });
    if (id) insertedIds.push(id);
    else duplicates += 1;
  }

  await store.setCursor(tenantId, mailbox, next);

  // Stranded = runnable requests that aren't the ones we just inserted: 'received' whose run never
  // started, or 'processing' whose lease expired (the run crashed mid-flight).
  const runnable = await store.listRunnable(tenantId);
  const reEnqueued = runnable.map((r) => r.id).filter((id) => !insertedIds.includes(id));
  const enqueueKeys: Record<string, string> = {};
  for (const id of insertedIds) enqueueKeys[id] = enqueueKey({ id, claimed_at: null });
  for (const r of runnable) if (!insertedIds.includes(r.id)) enqueueKeys[r.id] = enqueueKey(r);

  return { insertedIds, duplicates, cursor: next, reEnqueued, toRun: [...insertedIds, ...reEnqueued], enqueueKeys };
}
