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
      scope: "https://graph.microsoft.com/.default",
    }).toString();
    const res = await this.fetchImpl(`${LOGIN}/${this.creds.tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error(`Graph token request failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in - 60) * 1000 };
    return this.token.value;
  }

  async get(path: string): Promise<unknown> {
    const token = await this.accessToken();
    const res = await this.fetchImpl(`${GRAPH}${path}`, { headers: { Authorization: `Bearer ${token}` } });
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
}

const GRAPH_ENV_KEYS = [
  "GRAPH_TENANT_ID",
  "GRAPH_CLIENT_ID",
  "GRAPH_CLIENT_SECRET",
  "GRAPH_MAILBOX_USER",
  "GRAPH_QUOTE_FOLDER",
] as const;

/** True only when every live-Graph env var is set — the poll uses this to pick live vs stub. */
export function hasGraphEnv(): boolean {
  return GRAPH_ENV_KEYS.every((k) => Boolean(process.env[k]));
}

/** Build the live, folder-scoped OutlookMailbox from env. Throws if any var is missing
 *  (mirrors createServiceClient's env handling). */
export function createOutlookMailboxFromEnv(): OutlookMailbox {
  const tenantId = process.env.GRAPH_TENANT_ID;
  const clientId = process.env.GRAPH_CLIENT_ID;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET;
  const user = process.env.GRAPH_MAILBOX_USER;
  const folderId = process.env.GRAPH_QUOTE_FOLDER;
  if (!tenantId || !clientId || !clientSecret || !user || !folderId) {
    throw new Error(
      "GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET / GRAPH_MAILBOX_USER / GRAPH_QUOTE_FOLDER required for the live Graph mailbox",
    );
  }
  return new OutlookMailbox(new GraphFetchTransport({ tenantId, clientId, clientSecret }), user, folderId);
}
