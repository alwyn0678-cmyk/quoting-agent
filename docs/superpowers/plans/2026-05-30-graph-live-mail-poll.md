# Live MS Graph Mail Poll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stub mailbox with a live, read-only MS Graph transport so a real email lands in `alwyn@northscale.studio`'s "Quote requests" folder and flows end-to-end to the dashboard.

**Architecture:** The `MailboxReader` port and the whole downstream pipeline already exist. We add folder-scoping to `OutlookMailbox`, build a real `GraphFetchTransport` (client-credentials + `fetch`), an env factory that swaps it in for the stub when configured, and a non-CI smoke script. No downstream code changes.

**Tech Stack:** TypeScript (NodeNext, strict), vitest, MS Graph REST (`/v1.0`), client-credentials OAuth, Trigger.dev v4 (poll task).

---

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `packages/graph/src/outlook.ts` | modify | Add optional `folderId` → folder-scoped read path |
| `packages/graph/src/outlook.test.ts` | modify | Test the folder-scoped path |
| `packages/graph/src/graph-transport.ts` | create | `GraphFetchTransport` (live `GraphTransport`) + `createOutlookMailboxFromEnv` + `hasGraphEnv` |
| `packages/graph/src/graph-transport.test.ts` | create | Hermetic tests (token cache, Bearer header, error throw, env factory) |
| `packages/trigger/src/trigger/poll.ts` | modify | One-line swap: live mailbox when env present, else stub |
| `scripts/graph_smoke.ts` | create | Live verification (folders mode + list mode); not in CI |
| `package.json` | modify | Add `graph:smoke` script |
| `docs/setup/graph-mail-poll-setup.md` | create | Exact Azure + Exchange + Outlook setup steps |

**Typecheck boundaries** (from `tsconfig.json`): `packages/graph/**` is in the root typecheck (`npm run typecheck`). `packages/trigger/**` is excluded (own typecheck — run from that package). `scripts/**` is not typechecked anywhere (run via `tsx`).

---

## Task 1: Folder-scoped read on `OutlookMailbox`

**Files:**
- Modify: `packages/graph/src/outlook.ts`
- Test: `packages/graph/src/outlook.test.ts`

- [ ] **Step 1: Write the failing test**

Add this `it` block inside the existing `describe("P-1B.5 — Outlook read by cursor", …)` in `packages/graph/src/outlook.test.ts`:

```ts
  it("scopes the read to a folder when a folderId is given (mailFolders path)", async () => {
    const transport = new FakeTransport({ value: [] });
    const box = new OutlookMailbox(transport, "alwyn@northscale.studio", "AAMk-quote-folder-id");
    await box.listSince("2026-05-01T00:00:00Z");

    expect(transport.gets[0]).toContain(
      "/users/alwyn@northscale.studio/mailFolders/AAMk-quote-folder-id/messages",
    );
    expect(transport.gets[0]).toContain("$filter=receivedDateTime gt 2026-05-01T00:00:00Z");
    expect(transport.gets[0]).not.toContain("/messages?$filter"); // not the whole-mailbox path
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/graph/src/outlook.test.ts -t "scopes the read to a folder"`
Expected: FAIL — `OutlookMailbox` constructor takes only 2 args / path is `/users/.../messages`.

- [ ] **Step 3: Write minimal implementation**

In `packages/graph/src/outlook.ts`, change the constructor to accept an optional `folderId` and make `listSince` build the folder path when it is set. Replace the constructor and the `path` assignment:

```ts
  constructor(
    private readonly transport: GraphTransport,
    private readonly userId: string,
    private readonly folderId?: string,
  ) {}
```

```ts
    const base = this.folderId
      ? `/users/${this.userId}/mailFolders/${this.folderId}/messages`
      : `/users/${this.userId}/messages`;
    const path =
      base +
      `?$filter=receivedDateTime gt ${cursor}` +
      `&$orderby=receivedDateTime asc` +
      `&$select=id,subject,from,body,receivedDateTime&$top=50`;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/graph/src/outlook.test.ts`
Expected: PASS (the new test + all existing ones — the 2-arg constructions still compile because `folderId` is optional).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/graph/src/outlook.ts packages/graph/src/outlook.test.ts
git commit -m "feat(graph): folder-scoped read on OutlookMailbox"
```

---

## Task 2: `GraphFetchTransport` (live client-credentials transport)

**Files:**
- Create: `packages/graph/src/graph-transport.ts`
- Test: `packages/graph/src/graph-transport.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/graph/src/graph-transport.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/graph/src/graph-transport.test.ts`
Expected: FAIL — `Cannot find module './graph-transport.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/graph/src/graph-transport.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/graph/src/graph-transport.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/graph/src/graph-transport.ts packages/graph/src/graph-transport.test.ts
git commit -m "feat(graph): GraphFetchTransport — live client-credentials Graph transport"
```

---

## Task 3: Env factory (`createOutlookMailboxFromEnv` + `hasGraphEnv`)

**Files:**
- Modify: `packages/graph/src/graph-transport.ts`
- Test: `packages/graph/src/graph-transport.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/graph/src/graph-transport.test.ts` (add `beforeEach, afterEach` to the vitest import at the top: `import { describe, it, expect, beforeEach, afterEach } from "vitest";`):

```ts
import { createOutlookMailboxFromEnv, hasGraphEnv } from "./graph-transport.js";
import { OutlookMailbox } from "./outlook.js";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/graph/src/graph-transport.test.ts -t "env factory"`
Expected: FAIL — `createOutlookMailboxFromEnv` / `hasGraphEnv` are not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `packages/graph/src/graph-transport.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/graph/src/graph-transport.test.ts`
Expected: PASS (all groups).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/graph/src/graph-transport.ts packages/graph/src/graph-transport.test.ts
git commit -m "feat(graph): createOutlookMailboxFromEnv + hasGraphEnv factory"
```

---

## Task 4: Swap the live mailbox into the scheduled poll

**Files:**
- Modify: `packages/trigger/src/trigger/poll.ts`

This package is **excluded from the root typecheck** — verify with its own typecheck.

- [ ] **Step 1: Make the change**

In `packages/trigger/src/trigger/poll.ts`, add the factory import next to the existing stub import:

```ts
import { createStubMailbox } from "../../../ingest/src/stub-transport.js";
import { createOutlookMailboxFromEnv, hasGraphEnv } from "../../../graph/src/graph-transport.js";
```

Then replace the mailbox construction line:

```ts
    const mailbox = hasGraphEnv() ? createOutlookMailboxFromEnv() : createStubMailbox();
```

- [ ] **Step 2: Typecheck the trigger package**

Run: `npm --prefix packages/trigger run typecheck`
Expected: no errors. (If `--prefix` misbehaves, run `npm run typecheck` from inside `packages/trigger`.)

- [ ] **Step 3: Confirm the rest of the suite still passes**

Run: `npm test`
Expected: PASS (no test asserts on the stub-vs-live selection; behavior is unchanged when no Graph env is set).

- [ ] **Step 4: Commit**

```bash
git add packages/trigger/src/trigger/poll.ts
git commit -m "feat(trigger): poll uses live Graph mailbox when configured, else stub"
```

---

## Task 5: Smoke script + npm script + setup doc (live verification)

**Files:**
- Create: `scripts/graph_smoke.ts`
- Modify: `package.json`
- Create: `docs/setup/graph-mail-poll-setup.md`

`scripts/**` is not typechecked (run via `tsx`); its verification is the live run, not CI.

- [ ] **Step 1: Create the smoke script**

Create `scripts/graph_smoke.ts`:

```ts
import { GraphFetchTransport, createOutlookMailboxFromEnv } from "../packages/graph/src/graph-transport.js";

/**
 * Live, read-only smoke check for the Graph mail poll (NOT a CI test — needs real credentials).
 *   node --env-file=.env --import tsx scripts/graph_smoke.ts --folders   # list folder ids -> names
 *   node --env-file=.env --import tsx scripts/graph_smoke.ts             # list the configured folder
 */
async function main(): Promise<void> {
  const user = process.env.GRAPH_MAILBOX_USER;
  if (process.argv[2] === "--folders") {
    if (!process.env.GRAPH_TENANT_ID || !process.env.GRAPH_CLIENT_ID || !process.env.GRAPH_CLIENT_SECRET || !user) {
      throw new Error("GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET / GRAPH_MAILBOX_USER required");
    }
    const transport = new GraphFetchTransport({
      tenantId: process.env.GRAPH_TENANT_ID,
      clientId: process.env.GRAPH_CLIENT_ID,
      clientSecret: process.env.GRAPH_CLIENT_SECRET,
    });
    const res = (await transport.get(`/users/${user}/mailFolders?$top=100&$select=id,displayName`)) as {
      value: { id: string; displayName: string }[];
    };
    console.log("displayName\tid  (copy the 'Quote requests' id into GRAPH_QUOTE_FOLDER)");
    for (const f of res.value) console.log(`${f.displayName}\t${f.id}`);
    return;
  }

  const box = createOutlookMailboxFromEnv();
  const { messages, cursor } = await box.listSince("1970-01-01T00:00:00Z");
  console.log(`folder read OK — ${messages.length} message(s); next cursor ${cursor}`);
  for (const m of messages) console.log(`- ${m.receivedDateTime}  ${m.from}  | ${m.subject}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add to `"scripts"` (after the `"ingest"` line):

```json
    "graph:smoke": "node --env-file-if-exists=.env --import tsx scripts/graph_smoke.ts",
```

- [ ] **Step 3: Verify it loads (no creds needed)**

Run: `npm run graph:smoke`
Expected: it fails cleanly with the `...required for the live Graph mailbox` message (env not set yet) — proving the script wires up and imports resolve. NOT an error in the plan; it confirms the guard.

- [ ] **Step 4: Write the setup doc**

Create `docs/setup/graph-mail-poll-setup.md`:

````markdown
# Setup — live MS Graph mail poll (read-only, single mailbox)

One-time setup so the agent can read `alwyn@northscale.studio`'s "Quote requests" folder.
Secrets go in `.env` (gitignored) — never commit them.

## 1. Register the app (Microsoft Entra admin center)
1. **App registrations → New registration** → name `QuoteAgent Mail Poll`, single tenant → Register.
2. Copy **Application (client) ID** → `GRAPH_CLIENT_ID`, and **Directory (tenant) ID** → `GRAPH_TENANT_ID`.
3. **Certificates & secrets → New client secret** → copy the **Value** (shown once) → `GRAPH_CLIENT_SECRET`.
4. **API permissions → Add a permission → Microsoft Graph → Application permissions → `Mail.Read`** → Add.
   (Do NOT add `Mail.Send` or `Mail.ReadWrite` — Scope A is read-only.)
5. **Grant admin consent for <tenant>** → the `Mail.Read` row shows **Granted**.

## 2. Restrict the app to ONE mailbox (Exchange Online PowerShell)
Application `Mail.Read` is tenant-wide by default. Scope it to just this mailbox:

```powershell
Connect-ExchangeOnline -UserPrincipalName admin@northscale.studio

New-DistributionGroup -Name "QuoteAgent-Scope" -Type Security -Members alwyn@northscale.studio

New-ApplicationAccessPolicy -AppId <GRAPH_CLIENT_ID> `
  -PolicyScopeGroupId QuoteAgent-Scope@northscale.studio `
  -AccessRight RestrictAccess -Description "QuoteAgent read-only, single mailbox"

# Verify (allow up to ~30 min to propagate):
Test-ApplicationAccessPolicy -Identity alwyn@northscale.studio -AppId <GRAPH_CLIENT_ID>   # Granted
```

## 3. Outlook folder + rule
1. Create a folder named **Quote requests**.
2. Add a rule: **From `alwyn0678@gmail.com` → move to "Quote requests"**.

## 4. Fill `.env` and verify
```
GRAPH_TENANT_ID=...
GRAPH_CLIENT_ID=...
GRAPH_CLIENT_SECRET=...
GRAPH_MAILBOX_USER=alwyn@northscale.studio
GRAPH_QUOTE_FOLDER=        # get this in the next step
```
- `npm run graph:smoke -- --folders` → copy the **Quote requests** id into `GRAPH_QUOTE_FOLDER`.
- Send a test quote email from `alwyn0678@gmail.com` (it gets filed into the folder).
- `npm run graph:smoke` → it should print that message. ✅ Live read works.
````

- [ ] **Step 5: Commit**

```bash
git add scripts/graph_smoke.ts package.json docs/setup/graph-mail-poll-setup.md
git commit -m "feat(graph): graph_smoke script + graph:smoke + setup doc"
```

- [ ] **Step 6: Live verification (user-run — AC-G5)**

After the user completes `docs/setup/graph-mail-poll-setup.md`, run `npm run graph:smoke` and confirm a test email from `alwyn0678@gmail.com` appears. This is the acceptance for the live path; it is not a CI test.

---

## Deferred (not in this plan)
- Trigger.dev **prod** deploy with the Graph secrets (continuous polling).
- Scope B — draft-back to Outlook (`Mail.ReadWrite`, `createDraft`, approve-flow change).
- Gmail `MailboxReader` sibling.

---

## Self-Review

**Spec coverage:**
- Folder-scoping (spec §"What's new" 1) → Task 1.
- `GraphFetchTransport` token+Bearer+error (spec 2; AC-G1/AC-G2) → Task 2.
- `createOutlookMailboxFromEnv` factory + env config (spec 3; AC-G4) → Task 3.
- Wire into `trigger/poll.ts` with stub fallback (spec 4) → Task 4.
- Smoke script `--folders` + list mode, npm script, user setup, live check (spec 5; AC-G5) → Task 5.
- AC-G3 (folder path preserves the `receivedDateTime gt` filter) → Task 1 test asserts both. ✓
- Security posture (Mail.Read only, Application Access Policy, secrets in .env) → setup doc, Task 5. ✓

**Placeholder scan:** none — every code/test step shows complete content; `<GRAPH_CLIENT_ID>` in the setup doc is a deliberate user-substituted value, not a plan gap.

**Type consistency:** `GraphFetchTransport`, `GraphCredentials` (`tenantId`/`clientId`/`clientSecret`), `FetchLike`, `createOutlookMailboxFromEnv`, `hasGraphEnv`, env keys `GRAPH_TENANT_ID/GRAPH_CLIENT_ID/GRAPH_CLIENT_SECRET/GRAPH_MAILBOX_USER/GRAPH_QUOTE_FOLDER` are used identically across Tasks 2–5 and the smoke script. `OutlookMailbox(transport, userId, folderId?)` 3-arg shape from Task 1 matches the factory call in Task 3. ✓
