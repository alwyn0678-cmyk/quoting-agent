import { describe, it, expect } from "vitest";
import { OutlookMailbox, GRAPH_SCOPES, type GraphTransport } from "./outlook.js";

/** Fake Graph transport: records calls, returns canned data, and THROWS on any send path — so a
 *  send attempt fails the test (AC-7 mechanism). */
class FakeTransport implements GraphTransport {
  gets: string[] = [];
  posts: { path: string; body: unknown }[] = [];
  /** Pass an ARRAY to serve one response per get() in order (pagination); an object is served always. */
  constructor(private readonly getResponse: unknown = { value: [] }) {}

  async get(path: string): Promise<unknown> {
    if (/\/send|sendMail/i.test(path)) throw new Error(`AC-7 violation: send requested via GET ${path}`);
    this.gets.push(path);
    return Array.isArray(this.getResponse)
      ? this.getResponse[this.gets.length - 1]
      : this.getResponse;
  }
  async post(path: string, body: unknown): Promise<unknown> {
    if (/\/send|sendMail/i.test(path)) throw new Error(`AC-7 violation: send requested via POST ${path}`);
    this.posts.push({ path, body });
    return { id: "draft-1" };
  }
}

const msg = (id: string, t: string, addr: string, name: string) => ({
  id,
  subject: `Quote ${id}`,
  from: { emailAddress: { address: addr, name } },
  body: { content: `body ${id}` },
  receivedDateTime: t,
});

describe("P-1B.5 — Outlook read by cursor", () => {
  it("returns messages at-or-after the cursor (filter) and advances the cursor", async () => {
    const transport = new FakeTransport({
      value: [
        msg("a", "2026-05-01T10:00:00Z", "maria@apex.example", "Maria"),
        msg("b", "2026-05-02T09:30:00Z", "jon@beta.example", "Jon"),
      ],
    });
    const box = new OutlookMailbox(transport, "ops@linkport.example");
    const { messages, cursor } = await box.listSince("2026-04-30T00:00:00Z");

    expect(transport.gets[0]).toContain("$filter=receivedDateTime ge 2026-04-30T00%3A00%3A00Z");
    expect(messages.map((m) => m.id)).toEqual(["a", "b"]);
    expect(messages[0]?.from).toBe("Maria <maria@apex.example>");
    expect(messages[0]?.subject).toBe("Quote a");
    expect(messages[0]?.body).toBe("body a");
    expect(cursor).toBe("2026-05-02T09:30:00Z"); // latest receivedDateTime
  });

  it("leaves the cursor unchanged when nothing is newer", async () => {
    const box = new OutlookMailbox(new FakeTransport({ value: [] }), "ops@linkport.example");
    const { messages, cursor } = await box.listSince("2026-05-10T00:00:00Z");
    expect(messages).toEqual([]);
    expect(cursor).toBe("2026-05-10T00:00:00Z");
  });

  it("scopes the read to a folder when a folderId is given (mailFolders path)", async () => {
    const transport = new FakeTransport({ value: [] });
    const box = new OutlookMailbox(transport, "desk@linkport.example", "AAMk-quote-folder-id");
    await box.listSince("2026-05-01T00:00:00Z");

    expect(transport.gets[0]).toContain(
      "/users/desk@linkport.example/mailFolders/AAMk-quote-folder-id/messages",
    );
    expect(transport.gets[0]).toContain("$filter=receivedDateTime ge 2026-05-01T00%3A00%3A00Z");
    // not the whole-mailbox path (the folder path has /mailFolders/{id}/messages, not /{user}/messages)
    expect(transport.gets[0]).not.toContain("/users/desk@linkport.example/messages?$filter");
  });

  it("URL-encodes the folderId (opaque Graph ids can contain / + =)", async () => {
    const transport = new FakeTransport({ value: [] });
    const box = new OutlookMailbox(transport, "desk@linkport.example", "AAMk/Ab+c==");
    await box.listSince("2026-05-01T00:00:00Z");
    expect(transport.gets[0]).toContain("/mailFolders/AAMk%2FAb%2Bc%3D%3D/messages");
  });

  it("filters with ge and a URL-encoded cursor — same-second boundary mail is re-read, never skipped", async () => {
    const transport = new FakeTransport({ value: [] });
    const box = new OutlookMailbox(transport, "ops@linkport.example");
    await box.listSince("2026-04-30T12:34:56Z");
    // ge, not gt: a strict filter on a second-granularity cursor skips forever any message sharing
    // that second; dedup (graph_message_id) makes the ge re-read a harmless duplicate.
    expect(transport.gets[0]).toContain("$filter=receivedDateTime ge 2026-04-30T12%3A34%3A56Z");
    expect(transport.gets[0]).not.toContain("receivedDateTime gt ");
  });

  it("follows @odata.nextLink across pages (mail beyond page 1 is not lost)", async () => {
    const nextLink =
      "https://graph.microsoft.com/v1.0/users/ops@linkport.example/messages?$skiptoken=page2";
    const transport = new FakeTransport([
      {
        value: [msg("a", "2026-05-01T10:00:00Z", "maria@apex.example", "Maria")],
        "@odata.nextLink": nextLink,
      },
      { value: [msg("b", "2026-05-02T09:30:00Z", "jon@beta.example", "Jon")] },
    ]);
    const box = new OutlookMailbox(transport, "ops@linkport.example");
    const { messages, cursor } = await box.listSince("2026-04-30T00:00:00Z");

    expect(messages.map((m) => m.id)).toEqual(["a", "b"]); // both pages' messages returned
    expect(transport.gets).toHaveLength(2);
    // the nextLink was followed as a transport path (absolute /v1.0 origin stripped)
    expect(transport.gets[1]).toBe("/users/ops@linkport.example/messages?$skiptoken=page2");
    expect(cursor).toBe("2026-05-02T09:30:00Z"); // cursor reflects the LAST page's latest message
  });
});

describe("AC-7 / R1 — send-free by construction", () => {
  it("createDraft saves a draft via /messages (not a send path) and returns its id", async () => {
    const transport = new FakeTransport();
    const box = new OutlookMailbox(transport, "ops@linkport.example");
    const res = await box.createDraft({ subject: "Re: Quote", body: "all-in EUR 6,930." });

    expect(res.id).toBe("draft-1");
    expect(transport.posts).toHaveLength(1);
    expect(transport.posts[0]?.path).toBe("/users/ops@linkport.example/messages");
    expect(transport.posts[0]?.path).not.toMatch(/send/i); // not a send path
    // the fake throws on any send path, so reaching here proves no send was attempted
  });

  it("the wrapper exposes no send method (no send / sendMail)", () => {
    const proto = OutlookMailbox.prototype as unknown as Record<string, unknown>;
    expect(proto["send"]).toBeUndefined();
    expect(proto["sendMail"]).toBeUndefined();
  });

  it("GRAPH_SCOPES documents the read-path permissions (it is NOT token enforcement)", () => {
    // Honesty (audit 2026-07): this constant is never fed into a token request — client-credentials
    // auth uses `.default`, which carries every consented app permission INCLUDING Mail.Send. What
    // this asserts is that the read path's documented surface stays send-free; the real guarantee is
    // structural (no send method on OutlookMailbox — the test above), not token-level.
    expect([...GRAPH_SCOPES]).not.toContain("Mail.Send");
    expect([...GRAPH_SCOPES]).toContain("Mail.Read"); // it can read
    expect([...GRAPH_SCOPES]).toContain("Mail.ReadWrite"); // and create a draft
  });
});
