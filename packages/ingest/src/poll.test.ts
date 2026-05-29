import { describe, it, expect } from "vitest";
import { pollMailbox, type IngestStore, type MailboxReader, type ReceivedRequest } from "./poll.js";
import type { InboundMessage } from "../../graph/src/outlook.js";

function msg(id: string): InboundMessage {
  return {
    id,
    from: "maria@apex.example",
    subject: "Quote 1x40HC RTM->NY",
    body: "Please quote 1 x 40HC Rotterdam to New York.",
    receivedDateTime: `2026-05-25T10:0${id.slice(-1)}:00Z`,
  };
}

/** In-memory store mirroring the DB invariants: graph_message_id is GLOBALLY unique (the dedup key);
 *  rows + cursor are tenant-scoped. */
class FakeStore implements IngestStore {
  rows = new Map<string, { id: string; tenant_id: string; status: string }>(); // keyed by graph_message_id
  private cursors = new Map<string, string>();
  private seq = 0;
  async getCursor(t: string, m: string) {
    return this.cursors.get(`${t}:${m}`) ?? "1970-01-01T00:00:00Z";
  }
  async setCursor(t: string, m: string, c: string) {
    this.cursors.set(`${t}:${m}`, c);
  }
  async insertReceived(row: ReceivedRequest) {
    if (this.rows.has(row.graph_message_id)) return null; // UNIQUE graph_message_id -> dedup (AC-1)
    const id = `req-${++this.seq}`;
    this.rows.set(row.graph_message_id, { id, tenant_id: row.tenant_id, status: "received" });
    return id;
  }
  async listReceived(t: string) {
    return [...this.rows.values()].filter((r) => r.tenant_id === t && r.status === "received").map((r) => r.id);
  }
  complete(graphId: string) {
    const r = this.rows.get(graphId);
    if (r) r.status = "awaiting_review"; // its agent-run finished
  }
}

class FakeMailbox implements MailboxReader {
  private i = 0;
  constructor(private readonly batches: InboundMessage[][]) {}
  async listSince(cursor: string) {
    const messages = this.batches[this.i++] ?? [];
    const last = messages.at(-1);
    return { messages, cursor: last ? last.receivedDateTime : cursor };
  }
}

const TA = "aaaaaaaa-0000-4000-8000-00000000000a";
const TB = "bbbbbbbb-0000-4000-8000-00000000000b";
const MB = "inbox";

describe("1C.1 — scheduled poll (cursor + dedup + re-enqueue)", () => {
  it("AC-1: the same graph message polled twice yields exactly ONE quote_request", async () => {
    const store = new FakeStore();
    const mailbox = new FakeMailbox([
      [msg("m1"), msg("m2")],
      [msg("m2"), msg("m3")], // m2 reappears in the next cycle
    ]);

    const r1 = await pollMailbox(TA, MB, mailbox, store);
    expect(r1.insertedIds).toHaveLength(2);
    expect(r1.duplicates).toBe(0);
    expect(r1.reEnqueued).toEqual([]); // nothing stranded yet
    expect(r1.toRun).toEqual(r1.insertedIds);

    store.complete("m1"); // m1's run finished -> no longer 'received'

    const r2 = await pollMailbox(TA, MB, mailbox, store);
    expect(r2.duplicates).toBe(1); // m2 already seen — dedup hit (AC-1)
    expect(r2.insertedIds).toHaveLength(1); // only m3 is new
    expect(store.rows.size).toBe(3); // m1, m2, m3 — m2 never created a 2nd row

    // W5: m2 is stranded 'received' (pre-existing, not just-inserted) -> re-enqueued; m1 (done) is not.
    const m2id = store.rows.get("m2")!.id;
    const m3id = store.rows.get("m3")!.id;
    expect(r2.reEnqueued).toEqual([m2id]);
    expect(r2.toRun).toEqual([m3id, m2id]);
  });

  it("advances the cursor to the latest receivedDateTime seen, and persists it", async () => {
    const store = new FakeStore();
    const mailbox = new FakeMailbox([[msg("m1"), msg("m2")]]);
    const r = await pollMailbox(TA, MB, mailbox, store);
    expect(r.cursor).toBe("2026-05-25T10:02:00Z"); // m2's receivedDateTime
    expect(await store.getCursor(TA, MB)).toBe("2026-05-25T10:02:00Z");
  });

  it("advances the cursor monotonically — an unsorted/stale page never moves it backward (#4)", async () => {
    const store = new FakeStore();
    await pollMailbox(TA, MB, new FakeMailbox([[msg("m1"), msg("m2")]]), store); // cursor -> 10:02
    expect(await store.getCursor(TA, MB)).toBe("2026-05-25T10:02:00Z");

    // Unsorted page: a NEW message (10:05) followed by a STALE one (10:01). The cursor must jump to the
    // max (10:05), not regress to the last element (10:01) — else newer mail would be polled forever.
    const at = (rdt: string, id: string): InboundMessage => ({ id, from: "a@b.example", subject: "s", body: "b", receivedDateTime: rdt });
    const r = await pollMailbox(TA, MB, new FakeMailbox([[at("2026-05-25T10:05:00Z", "m5"), at("2026-05-25T10:01:00Z", "m1b")]]), store);
    expect(r.cursor).toBe("2026-05-25T10:05:00Z");
    expect(await store.getCursor(TA, MB)).toBe("2026-05-25T10:05:00Z");
  });

  it("P-TENANT: a poll for tenant A inserts/re-enqueues only A's rows, never B's", async () => {
    const store = new FakeStore();
    // B already has a stranded 'received' row from its own ingest.
    await store.insertReceived({
      tenant_id: TB,
      source: "poll",
      graph_message_id: "mb1",
      from_email: "x@b.example",
      subject: "s",
      body: "b",
      status: "received",
    });
    const bId = store.rows.get("mb1")!.id;

    const rA = await pollMailbox(TA, MB, new FakeMailbox([[msg("ma1")]]), store);

    expect(rA.insertedIds).toHaveLength(1);
    expect(rA.toRun).not.toContain(bId); // A never enqueues B's request
    expect(rA.reEnqueued).not.toContain(bId);
    expect(await store.listReceived(TA)).not.toContain(bId);
  });
});
