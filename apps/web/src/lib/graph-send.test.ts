import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  parseEmailAddress,
  buildSendMailBody,
  hasGraphSendEnv,
  sendQuoteReply,
  type FetchLike,
} from "./graph-send.js";

describe("parseEmailAddress", () => {
  it("extracts the address from 'Name <addr>' and bare addresses", () => {
    expect(parseEmailAddress("Alwyn Van Vuuren <alwyn0678@gmail.com>")).toBe("alwyn0678@gmail.com");
    expect(parseEmailAddress("buyer@apex.example")).toBe("buyer@apex.example");
    expect(parseEmailAddress("  spaced@x.io  ")).toBe("spaced@x.io");
  });
  it("returns null when there is no valid address", () => {
    expect(parseEmailAddress("(unknown sender)")).toBeNull();
    expect(parseEmailAddress("Name <not-an-address>")).toBeNull();
    expect(parseEmailAddress("")).toBeNull();
  });
});

describe("buildSendMailBody", () => {
  it("builds a plain-text Graph sendMail body with the recipient + Sent copy", () => {
    expect(buildSendMailBody("a@b.com", "Re: Quote", "All-in EUR 3,520.")).toEqual({
      message: {
        subject: "Re: Quote",
        body: { contentType: "Text", content: "All-in EUR 3,520." },
        toRecipients: [{ emailAddress: { address: "a@b.com" } }],
      },
      saveToSentItems: true,
    });
  });
});

describe("hasGraphSendEnv / sendQuoteReply", () => {
  const KEYS = ["GRAPH_TENANT_ID", "GRAPH_CLIENT_ID", "GRAPH_CLIENT_SECRET", "GRAPH_MAILBOX_USER"];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k];
    process.env.GRAPH_TENANT_ID = "tenant";
    process.env.GRAPH_CLIENT_ID = "client";
    process.env.GRAPH_CLIENT_SECRET = "secret";
    process.env.GRAPH_MAILBOX_USER = "desk@linkport.example";
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("hasGraphSendEnv is true only when every GRAPH_* var is set", () => {
    expect(hasGraphSendEnv()).toBe(true);
    delete process.env.GRAPH_CLIENT_SECRET;
    expect(hasGraphSendEnv()).toBe(false);
  });

  it("acquires a token then POSTs /sendMail with the bearer + reply body (handles a 202 no-body)", async () => {
    const calls: { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }[] = [];
    const fake: FetchLike = async (url, init) => {
      calls.push({ url, init });
      if (url.includes("/oauth2/v2.0/token")) {
        return { ok: true, status: 200, json: async () => ({ access_token: "tok-123" }), text: async () => "" };
      }
      return { ok: true, status: 202, json: async () => ({}), text: async () => "" }; // sendMail: 202, empty
    };

    await sendQuoteReply("buyer@apex.example", "Re: Quote", "All-in EUR 3,520.", fake);

    expect(calls[0].url).toContain("/tenant/oauth2/v2.0/token");
    const send = calls[1];
    expect(send.url).toBe("https://graph.microsoft.com/v1.0/users/desk%40linkport.example/sendMail");
    expect(send.init?.method).toBe("POST");
    expect(send.init?.headers?.Authorization).toBe("Bearer tok-123");
    expect(JSON.parse(send.init!.body!)).toEqual(buildSendMailBody("buyer@apex.example", "Re: Quote", "All-in EUR 3,520."));
  });

  it("throws when Graph rejects the send (so the caller never flips to 'sent')", async () => {
    const fake: FetchLike = async (url) =>
      url.includes("/token")
        ? { ok: true, status: 200, json: async () => ({ access_token: "t" }), text: async () => "" }
        : { ok: false, status: 403, json: async () => ({}), text: async () => "Forbidden" };
    await expect(sendQuoteReply("a@b.com", "s", "b", fake)).rejects.toThrow(/sendMail failed: 403/);
  });
});
