import { OutlookMailbox, type GraphTransport } from "../../graph/src/outlook.js";

/**
 * Deterministic stand-in for the live MS Graph transport (Phase 1C live, L1). It satisfies the SAME
 * `GraphTransport` seam the real client-credentials transport will, wrapped by the real
 * `OutlookMailbox` — so the live swap is exactly: replace this transport, keep the same mailbox + poll.
 *
 * No new domain content is invented here. The two messages are copied VERBATIM from the eval golden
 * set (evals/fixtures/01-complete-40hc-x2.json and 04-missing-container-type.json), which are
 * themselves the project's assumption-logged sample emails. One drives the quote path and one the
 * escalate path, so a single poll cycle demonstrates both outcomes end-to-end. The receivedDateTime
 * values are fabricated (the fixtures carry none) purely to drive the cursor — arbitrary but fixed.
 */

interface StubMessage {
  id: string;
  name?: string;
  address: string;
  subject: string;
  body: string;
  receivedDateTime: string;
}

const CORPUS: StubMessage[] = [
  {
    id: "stub-01-complete-40hc-x2", // evals/fixtures/01-complete-40hc-x2.json -> quote path
    name: "Maria Jansen",
    address: "procurement@apexcoffee.example",
    subject: "Quote request: 2 x 40HC Rotterdam to New York",
    body: "Dear Linkport,\n\nWe would like a rate for an ocean FCL shipment from Rotterdam to New York.\n\n- 2 x 40' High Cube containers\n- Commodity: roasted coffee (palletised), approx. 21,000 kg per container\n- Incoterm: FOB Rotterdam\n- Cargo ready: 12 June 2026\n\nCould you send your all-in quote?\n\nKind regards,\nMaria Jansen\nApex Coffee Importers",
    receivedDateTime: "2026-05-28T09:00:00Z",
  },
  {
    id: "stub-04-missing-container-type", // evals/fixtures/04-missing-container-type.json -> escalate path
    address: "ops@freshflowers.example",
    subject: "Shipping quote Rotterdam to New York",
    body: "Hi,\n\nCan you quote us for a couple of containers from Rotterdam to New York next month? Cargo is cut flowers (refrigerated).\n\nThanks",
    receivedDateTime: "2026-05-28T09:05:00Z",
  },
];

/** OutlookMailbox.listSince builds "...$filter=receivedDateTime gt <cursor>&$orderby=...". */
function parseCursor(path: string): string {
  const m = /receivedDateTime gt ([^&]+)/.exec(path);
  return m && m[1] ? decodeURIComponent(m[1]) : "1970-01-01T00:00:00Z";
}

export class StubGraphTransport implements GraphTransport {
  /** Server-side $filter is mimicked here: return only corpus messages newer than the cursor, asc. */
  async get(path: string): Promise<unknown> {
    const cursor = parseCursor(path);
    const value = CORPUS.filter((m) => m.receivedDateTime > cursor)
      .sort((a, b) => (a.receivedDateTime < b.receivedDateTime ? -1 : 1))
      .map((m) => ({
        id: m.id,
        subject: m.subject,
        from: { emailAddress: { address: m.address, name: m.name } },
        body: { content: m.body },
        receivedDateTime: m.receivedDateTime,
      }));
    return { value };
  }

  /** The poll loop only reads (listSince); createDraft is not exercised by it. Implemented so the seam
   *  is a complete GraphTransport — returns a deterministic id. */
  async post(_path: string, _body: unknown): Promise<unknown> {
    return { id: "stub-draft" };
  }
}

/** A MailboxReader (structurally) backed by the stub transport: the real OutlookMailbox over a fake. */
export function createStubMailbox(userId = "stub-inbox"): OutlookMailbox {
  return new OutlookMailbox(new StubGraphTransport(), userId);
}
