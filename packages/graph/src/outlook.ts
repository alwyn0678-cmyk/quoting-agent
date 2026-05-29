/**
 * MS Graph / Outlook wrapper (1B.5): read inbound mail by cursor + create a DRAFT reply.
 * There is NO send path — by construction (D-14 / AUTONOMY R1): `Mail.Send` is never in the
 * requested scopes (GRAPH_SCOPES) and this class exposes no send method. The real transport
 * (Graph SDK / fetch + client-credentials auth) is wired in 1C; here the read/create-draft LOGIC
 * lives over an injectable `GraphTransport` seam and is proven hermetically against a fake.
 */

export interface GraphTransport {
  get(path: string): Promise<unknown>;
  post(path: string, body: unknown): Promise<unknown>;
}

/**
 * The Graph scopes this wrapper needs. `Mail.ReadWrite` is required to CREATE a draft; it does NOT
 * grant sending — that is `Mail.Send`, which is deliberately ABSENT (R1 / D-14, proven by P-1B.5).
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
  ) {}

  /**
   * List messages newer than `cursor` (an ISO receivedDateTime), oldest-first, and return the new
   * cursor (the latest receivedDateTime seen, or the old cursor if nothing new). The poll (1C.1)
   * persists each message as a quote_request and advances the stored cursor.
   */
  async listSince(cursor: string): Promise<{ messages: InboundMessage[]; cursor: string }> {
    const path =
      `/users/${this.userId}/messages` +
      `?$filter=receivedDateTime gt ${cursor}` +
      `&$orderby=receivedDateTime asc` +
      `&$select=id,subject,from,body,receivedDateTime&$top=50`;
    const res = (await this.transport.get(path)) as { value?: GraphMessage[] };
    const messages = (res.value ?? []).map(toInbound);
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
