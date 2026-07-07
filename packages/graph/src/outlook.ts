/**
 * MS Graph / Outlook wrapper (1B.5): read inbound mail by cursor + create a DRAFT reply.
 * There is NO send path on this class — enforced by CODE STRUCTURE (D-14 / AUTONOMY R1): it exposes
 * no send method and its tests prove no send endpoint is ever hit. Honest limit (audit 2026-07): the
 * TOKEN does not enforce this — client-credentials auth requests `.default`, which carries every
 * application permission consented to the app registration, Mail.Send included (see GRAPH_SCOPES).
 * The real transport (Graph SDK / fetch + client-credentials auth) is wired in 1C; here the
 * read/create-draft LOGIC lives over an injectable `GraphTransport` seam and is proven hermetically
 * against a fake.
 */

export interface GraphTransport {
  get(path: string): Promise<unknown>;
  post(path: string, body: unknown): Promise<unknown>;
}

/**
 * The Graph permissions this wrapper USES — documentation, NOT enforcement. This constant is never
 * fed into any token request: the client-credentials flow (graph-transport.ts) requests scope
 * `.default`, which carries EVERY application permission consented to the app registration —
 * including Mail.Send, which the send-outbox worker legitimately uses under the same GRAPH_CLIENT_ID.
 * Read-path send-incapability is therefore enforced by code structure (no send method on this class /
 * the mailbox transport seam), NOT by the token. True token-level least privilege would need a
 * separate app registration for the read path (R1 / D-14 honesty, audit 2026-07).
 */
export const GRAPH_SCOPES = ["Mail.Read", "Mail.ReadWrite"] as const;

export interface InboundMessage {
  id: string;
  from: string; // "Name <addr>" — matches the agent's EmailInput.from shape
  subject: string;
  body: string;
  receivedDateTime: string; // ISO; doubles as the poll cursor
}

interface GraphMessage {
  id: string;
  subject: string | null;
  from?: { emailAddress?: { address?: string; name?: string } };
  body?: { content?: string };
  receivedDateTime: string;
}

/**
 * Pagination hard cap for ONE listSince call: 20 pages × $top=50 = 1000 messages. A runaway-loop
 * guard, not a correctness bound — the returned cursor is the last message actually seen, so a capped
 * cycle resumes exactly where it stopped on the next poll (`ge` + dedup make the overlap safe).
 */
const MAX_PAGES = 20;

/** @odata.nextLink is an ABSOLUTE Graph URL, but the GraphTransport seam takes a path — strip this. */
const GRAPH_V1_ORIGIN = /^https:\/\/graph\.microsoft\.com\/v1\.0/i;

function toInbound(m: GraphMessage): InboundMessage {
  const addr = m.from?.emailAddress?.address ?? "";
  const name = m.from?.emailAddress?.name;
  return {
    id: m.id,
    from: name ? `${name} <${addr}>` : addr,
    subject: m.subject ?? "",
    body: m.body?.content ?? "",
    receivedDateTime: m.receivedDateTime,
  };
}

export class OutlookMailbox {
  constructor(
    private readonly transport: GraphTransport,
    private readonly userId: string,
    private readonly folderId?: string,
  ) {}

  /**
   * List messages at-or-after `cursor` (an ISO receivedDateTime), oldest-first, following
   * `@odata.nextLink` until exhausted (capped at MAX_PAGES). Two deliberate choices close a mail-loss
   * window (audit 2026-07):
   * - The filter is `ge`, NOT `gt`: receivedDateTime has second granularity, so `gt` skips FOREVER any
   *   message sharing the cursor's second (e.g. one cut off by a page boundary). Re-reading the
   *   boundary message is safe — the tenant-scoped graph_message_id dedup (migration 0008, enforced by
   *   the ingest store) turns it into a no-op duplicate.
   * - The cursor is encodeURIComponent-ed: it is interpolated into a URL query string, and raw
   *   `:` / `+` (ISO timestamps, offsets) would otherwise corrupt the request.
   * Returns the new cursor (latest receivedDateTime seen, or the old cursor if nothing new). The poll
   * (1C.1) persists each message as a quote_request and advances the stored cursor.
   */
  async listSince(cursor: string): Promise<{ messages: InboundMessage[]; cursor: string }> {
    const base = this.folderId
      ? `/users/${this.userId}/mailFolders/${encodeURIComponent(this.folderId)}/messages`
      : `/users/${this.userId}/messages`;
    let path: string | null =
      base +
      `?$filter=receivedDateTime ge ${encodeURIComponent(cursor)}` +
      `&$orderby=receivedDateTime asc` +
      `&$select=id,subject,from,body,receivedDateTime&$top=50`;
    const messages: InboundMessage[] = [];
    for (let page = 0; path !== null && page < MAX_PAGES; page += 1) {
      const res = (await this.transport.get(path)) as {
        value?: GraphMessage[];
        "@odata.nextLink"?: string;
      };
      messages.push(...(res.value ?? []).map(toInbound));
      const next = res["@odata.nextLink"];
      path = next ? next.replace(GRAPH_V1_ORIGIN, "") : null;
    }
    const last = messages.at(-1);
    return { messages, cursor: last ? last.receivedDateTime : cursor };
  }

  /**
   * Create a DRAFT reply in the mailbox (saved, never sent). Posts to /messages, which Graph stores
   * as a draft. No send call exists anywhere in this wrapper.
   */
  async createDraft(input: { subject: string; body: string }): Promise<{ id: string }> {
    const res = (await this.transport.post(`/users/${this.userId}/messages`, {
      subject: input.subject,
      body: { contentType: "Text", content: input.body },
    })) as { id: string };
    return { id: res.id };
  }
}
