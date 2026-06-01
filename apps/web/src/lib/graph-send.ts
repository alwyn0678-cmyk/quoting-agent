/**
 * Outlook SEND for the Approve action (DECISION_LOG D-27 — REVERSES D-14/R1's "agent never sends").
 * Kept INSIDE apps/web (NOT imported from packages/graph) so the dashboard stays a standalone build
 * with no cross-package dependency — the same D-19 decoupling dashboard.ts/usage.ts rely on. App-only
 * client-credentials token + Graph /sendMail (which returns 202 Accepted with NO body).
 *
 * Env-gated: hasGraphSendEnv() is false when any GRAPH_* var is missing, so Approve falls back to a
 * simulated send (stub-safe) — the deployed dashboard still works before GRAPH_* is set on it. The
 * GRAPH_* vars are server-only (never NEXT_PUBLIC_), so the secret never reaches the browser.
 */

const LOGIN = "https://login.microsoftonline.com";
const GRAPH = "https://graph.microsoft.com/v1.0";

/** Extract a bare address from an EmailInput.from ("Name <addr>" | "addr"); null if not an address. */
export function parseEmailAddress(from: string): string | null {
  const m = from.match(/<([^>]+)>/);
  const addr = (m?.[1] ?? from).trim();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr) ? addr : null;
}

/** Pure: the Graph /sendMail request body for a plain-text reply. saveToSentItems keeps a Sent copy. */
export function buildSendMailBody(to: string, subject: string, body: string) {
  return {
    message: {
      subject,
      body: { contentType: "Text", content: body },
      toRecipients: [{ emailAddress: { address: to } }],
    },
    saveToSentItems: true,
  };
}

const GRAPH_SEND_KEYS = [
  "GRAPH_TENANT_ID",
  "GRAPH_CLIENT_ID",
  "GRAPH_CLIENT_SECRET",
  "GRAPH_MAILBOX_USER",
] as const;

/** True only when every var the send path needs is present. When false, Approve stays simulated. */
export function hasGraphSendEnv(): boolean {
  return GRAPH_SEND_KEYS.every((k) => Boolean(process.env[k]));
}

/** The minimal fetch shape used here (decoupled from ambient DOM typing; trivially fakeable in tests). */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

const defaultFetch: FetchLike = (url, init) =>
  (globalThis as unknown as { fetch: FetchLike }).fetch(url, init);

async function accessToken(fetchImpl: FetchLike): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.GRAPH_CLIENT_ID ?? "",
    client_secret: process.env.GRAPH_CLIENT_SECRET ?? "",
    scope: "https://graph.microsoft.com/.default",
  }).toString();
  const res = await fetchImpl(`${LOGIN}/${process.env.GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Graph token request failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token?: unknown };
  if (typeof json.access_token !== "string" || json.access_token.length === 0) {
    throw new Error("Graph token response missing access_token");
  }
  return json.access_token;
}

/**
 * Send a plain-text reply FROM the configured mailbox (GRAPH_MAILBOX_USER) to `to`. Throws on any
 * failure — the caller MUST NOT flip the request to 'sent' unless this resolves (send-first ordering).
 */
export async function sendQuoteReply(
  to: string,
  subject: string,
  body: string,
  fetchImpl: FetchLike = defaultFetch,
): Promise<void> {
  const token = await accessToken(fetchImpl);
  const user = process.env.GRAPH_MAILBOX_USER ?? "";
  const res = await fetchImpl(`${GRAPH}/users/${encodeURIComponent(user)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(buildSendMailBody(to, subject, body)),
  });
  if (!res.ok) throw new Error(`Graph sendMail failed: ${res.status} ${await res.text()}`);
  // 202 Accepted, no body — nothing to parse.
}
