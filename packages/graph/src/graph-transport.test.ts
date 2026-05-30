import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GraphFetchTransport, createOutlookMailboxFromEnv, hasGraphEnv } from "./graph-transport.js";
import { OutlookMailbox } from "./outlook.js";

type Call = { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } };

/** Build a fake fetch: `route(url)` returns the canned response for that URL. Records every call. */
function fakeFetch(route: (url: string) => { ok?: boolean; status?: number; body: unknown }) {
  const calls: Call[] = [];
  const fn = async (url: string, init?: Call["init"]) => {
    calls.push({ url, init });
    const r = route(url);
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.body,
      text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body)),
    };
  };
  return { fn, calls };
}

const TOKEN_URL = "/oauth2/v2.0/token";

describe("GraphFetchTransport", () => {
  it("AC-G1: attaches a Bearer token and caches it across calls", async () => {
    const { fn, calls } = fakeFetch((url) =>
      url.includes(TOKEN_URL)
        ? { body: { access_token: "tok-123", expires_in: 3600 } }
        : { body: { value: [] } },
    );
    const t = new GraphFetchTransport({ tenantId: "T", clientId: "C", clientSecret: "S" }, fn);

    await t.get("/users/u/messages");
    await t.get("/users/u/mailFolders/f/messages");

    const tokenCalls = calls.filter((c) => c.url.includes(TOKEN_URL));
    expect(tokenCalls).toHaveLength(1); // token cached — requested once for two calls
    expect(tokenCalls[0]?.url).toBe("https://login.microsoftonline.com/T/oauth2/v2.0/token");

    const graphCalls = calls.filter((c) => c.url.startsWith("https://graph.microsoft.com/v1.0"));
    expect(graphCalls).toHaveLength(2);
    expect(graphCalls[0]?.url).toBe("https://graph.microsoft.com/v1.0/users/u/messages");
    expect(graphCalls[0]?.init?.headers?.["Authorization"]).toBe("Bearer tok-123");
  });

  it("AC-G2: throws when Graph returns a non-2xx (does not swallow as empty)", async () => {
    const { fn } = fakeFetch((url) =>
      url.includes(TOKEN_URL)
        ? { body: { access_token: "tok", expires_in: 3600 } }
        : { ok: false, status: 403, body: "Forbidden" },
    );
    const t = new GraphFetchTransport({ tenantId: "T", clientId: "C", clientSecret: "S" }, fn);
    await expect(t.get("/users/u/messages")).rejects.toThrow(/403/);
  });

  it("throws when the token request fails", async () => {
    const { fn } = fakeFetch(() => ({ ok: false, status: 401, body: "bad creds" }));
    const t = new GraphFetchTransport({ tenantId: "T", clientId: "C", clientSecret: "S" }, fn);
    await expect(t.get("/users/u/messages")).rejects.toThrow(/token request failed: 401/);
  });
});

describe("env factory", () => {
  const KEYS = [
    "GRAPH_TENANT_ID",
    "GRAPH_CLIENT_ID",
    "GRAPH_CLIENT_SECRET",
    "GRAPH_MAILBOX_USER",
    "GRAPH_QUOTE_FOLDER",
  ] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  function setAll() {
    process.env.GRAPH_TENANT_ID = "T";
    process.env.GRAPH_CLIENT_ID = "C";
    process.env.GRAPH_CLIENT_SECRET = "S";
    process.env.GRAPH_MAILBOX_USER = "alwyn@northscale.studio";
    process.env.GRAPH_QUOTE_FOLDER = "F";
  }

  it("AC-G4: hasGraphEnv is false unless ALL vars are present", () => {
    expect(hasGraphEnv()).toBe(false);
    process.env.GRAPH_TENANT_ID = "T";
    process.env.GRAPH_CLIENT_ID = "C";
    process.env.GRAPH_CLIENT_SECRET = "S";
    process.env.GRAPH_MAILBOX_USER = "alwyn@northscale.studio";
    expect(hasGraphEnv()).toBe(false); // folder still missing
    process.env.GRAPH_QUOTE_FOLDER = "F";
    expect(hasGraphEnv()).toBe(true);
  });

  it("throws when env is incomplete", () => {
    expect(() => createOutlookMailboxFromEnv()).toThrow(/required/i);
  });

  it("builds an OutlookMailbox when env is complete", () => {
    setAll();
    expect(createOutlookMailboxFromEnv()).toBeInstanceOf(OutlookMailbox);
  });
});
