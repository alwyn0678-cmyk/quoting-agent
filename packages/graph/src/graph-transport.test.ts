import { describe, it, expect } from "vitest";
import { GraphFetchTransport } from "./graph-transport.js";

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
