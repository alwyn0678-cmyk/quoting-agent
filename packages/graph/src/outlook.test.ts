import { describe, it, expect } from "vitest";
import { OutlookMailbox, GRAPH_SCOPES, type GraphTransport } from "./outlook.js";

/** Fake Graph transport: records calls, returns canned data, and THROWS on any send path — so a
 *  send attempt fails the test (AC-7 mechanism). */
class FakeTransport implements GraphTransport {
  gets: string[] = [];
  posts: { path: string; body: unknown }[] = [];
  constructor(private readonly getResponse: unknown = { value: [] }) {}

  async get(path: string): Promise<unknown> {
    if (/\/send|sendMail/i.test(path)) throw new Error(`AC-7 violation: send requested via GET ${path}`);
    this.gets.push(path);
    return this.getResponse;
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
  it("returns only messages newer than the cursor (filter) and advances the cursor", async () => {
    const transport = new FakeTransport({
      value: [
        msg("a", "2026-05-01T10:00:00Z", "maria@apex.example", "Maria"),
        msg("b", "2026-05-02T09:30:00Z", "jon@beta.example", "Jon"),
      ],
    });
    const box = new OutlookMailbox(transport, "ops@linkport.example");
    const { messages, cursor } = await box.listSince("2026-04-30T00:00:00Z");

    expect(transport.gets[0]).toContain("$filter=receivedDateTime gt 2026-04-30T00:00:00Z");
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

  it("the requested Graph scopes exclude Mail.Send", () => {
    expect([...GRAPH_SCOPES]).not.toContain("Mail.Send");
    expect([...GRAPH_SCOPES]).toContain("Mail.Read"); // it can read
    expect([...GRAPH_SCOPES]).toContain("Mail.ReadWrite"); // and create a draft
  });
});
