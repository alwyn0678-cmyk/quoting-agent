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
  /** Request ids still in 'received' for THIS tenant (ingested, not yet successfully run). */
  listReceived(tenantId: string): Promise<string[]>;
}

/** Just the read half of OutlookMailbox the poll uses (structural — real wrapper + fakes satisfy it). */
export interface MailboxReader {
  listSince(cursor: string): Promise<{ messages: InboundMessage[]; cursor: string }>;
}

export interface PollResult {
  insertedIds: string[]; // request ids newly ingested this cycle
  duplicates: number; // messages already seen (dedup hits — AC-1)
  cursor: string; // advanced cursor
  reEnqueued: string[]; // pre-existing stranded 'received' request ids (W5)
  toRun: string[]; // the set to trigger an agent-run for: new ∪ stranded
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

  // Stranded = 'received' requests that aren't the ones we just inserted (their run never finished).
  const received = await store.listReceived(tenantId);
  const reEnqueued = received.filter((id) => !insertedIds.includes(id));

  return { insertedIds, duplicates, cursor: next, reEnqueued, toRun: [...insertedIds, ...reEnqueued] };
}
