import { OutlookMailbox, type GraphTransport } from "./outlook.js";

/**
 * Live MS Graph transport (Phase 1C live): the real twin of StubGraphTransport. Acquires an app-only
 * (client-credentials) token, caches it until shortly before expiry, and calls Graph /v1.0 with a
 * Bearer header. Read is all Scope A needs; `post` completes the GraphTransport seam but is unused.
 */

const LOGIN = "https://login.microsoftonline.com";
const GRAPH = "https://graph.microsoft.com/v1.0";

export interface GraphCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

/** The minimal fetch shape we depend on — decoupled from ambient `fetch` typing (lib is ES2022, no DOM). */
type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

const defaultFetch: FetchLike = (url, init) =>
  (globalThis as unknown as { fetch: FetchLike }).fetch(url, init);

export class GraphFetchTransport implements GraphTransport {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly creds: GraphCredentials,
    private readonly fetchImpl: FetchLike = defaultFetch,
  ) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.creds.clientId,
      client_secret: this.creds.clientSecret,
      // `.default` = ALL application permissions consented to this app registration — Mail.Send
      // included (the send worker shares this GRAPH_CLIENT_ID). App-only tokens cannot express
      // "read-only": least privilege on the read path is structural (OutlookMailbox exposes no send
      // method), NOT token-level; see GRAPH_SCOPES in outlook.ts for the honest statement.
      scope: "https://graph.microsoft.com/.default",
    }).toString();
    const res = await this.fetchImpl(`${LOGIN}/${this.creds.tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error(`Graph token request failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    const value = json.access_token;
    const expiresIn = json.expires_in;
    if (typeof value !== "string" || value.length === 0 || typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new Error("Graph token response malformed (missing access_token / expires_in)");
    }
    this.token = { value, expiresAt: Date.now() + (expiresIn - 60) * 1000 };
    return this.token.value;
  }

  async get(path: string): Promise<unknown> {
    const token = await this.accessToken();
    const res = await this.fetchImpl(`${GRAPH}${path}`, {
      // Prefer text bodies: Graph returns HTML by default, but the agent extracts from plain text.
      headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="text"' },
    });
    if (!res.ok) throw new Error(`Graph GET ${path} failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async post(path: string, body: unknown): Promise<unknown> {
    const token = await this.accessToken();
    const res = await this.fetchImpl(`${GRAPH}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Graph POST ${path} failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  /**
   * Send mail as `userId` via Graph /sendMail. Returns 202 Accepted with NO body, so — unlike post() —
   * nothing is parsed. D-27: a deliberate SEND capability on the LIVE transport, used only by the
   * trusted send-outbox worker AFTER a human Approve (reverses R1/D-14's "no send"). Never reached by
   * the autonomous run or the browser dashboard.
   */
  async sendMail(userId: string, sendMailBody: unknown): Promise<void> {
    const token = await this.accessToken();
    const res = await this.fetchImpl(`${GRAPH}/users/${encodeURIComponent(userId)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(sendMailBody),
    });
    if (!res.ok) throw new Error(`Graph sendMail ${userId} failed: ${res.status} ${await res.text()}`);
  }
}

/** Env the live Graph mailbox needs — the SINGLE source of truth: hasGraphEnv, the factory below, and
 *  the poll's loud-failure message all derive from this list, so list and checks cannot desync. */
export const GRAPH_ENV_KEYS = [
  "GRAPH_TENANT_ID",
  "GRAPH_CLIENT_ID",
  "GRAPH_CLIENT_SECRET",
  "GRAPH_MAILBOX_USER",
  "GRAPH_QUOTE_FOLDER",
] as const;

/** The subset of `keys` not set (or empty) in the environment — factories and callers derive both
 *  their checks and their error messages from this, against the exported key lists. */
export function missingEnv(keys: readonly string[]): string[] {
  return keys.filter((k) => !process.env[k]);
}

/** True only when every live-Graph env var is set — callers use this to gate the live path. */
export function hasGraphEnv(): boolean {
  return missingEnv(GRAPH_ENV_KEYS).length === 0;
}

/** Build the live, folder-scoped OutlookMailbox from env. Throws NAMING the missing keys if any var
 *  is absent — the check is derived from GRAPH_ENV_KEYS, never a hand-maintained copy. */
export function createOutlookMailboxFromEnv(): OutlookMailbox {
  const missing = missingEnv(GRAPH_ENV_KEYS);
  if (missing.length > 0) {
    throw new Error(`${missing.join(" / ")} required for the live Graph mailbox`);
  }
  // Safe cast: missingEnv just proved every key is set and non-empty.
  const env = process.env as Record<(typeof GRAPH_ENV_KEYS)[number], string>;
  return new OutlookMailbox(
    new GraphFetchTransport({
      tenantId: env.GRAPH_TENANT_ID,
      clientId: env.GRAPH_CLIENT_ID,
      clientSecret: env.GRAPH_CLIENT_SECRET,
    }),
    env.GRAPH_MAILBOX_USER,
    env.GRAPH_QUOTE_FOLDER,
  );
}
