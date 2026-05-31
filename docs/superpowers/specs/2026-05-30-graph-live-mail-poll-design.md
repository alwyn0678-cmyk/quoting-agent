# Spec — Live MS Graph mail poll (Scope A, read-only)

- **Date:** 2026-05-30
- **Status:** approved design, pre-implementation
- **Workstream:** Q1 (live mailbox), provider = MS Graph now / Gmail later
- **Scope decision:** A (read-only) + dev-first

## Goal

Replace the deterministic stub mailbox with a **live, read-only** MS Graph transport so a
real quote-request email lands in the agent's mailbox and flows end-to-end to the dashboard:

> `alwyn0678@gmail.com` (client) → emails → `desk@linkport.example` (M365 inbox) → an Outlook
> rule files it into the **"Quote requests"** folder → the scheduled poll reads that folder via
> Graph → persists it as a `quote_request` → the existing durable run (extract → gate → price →
> draft) → atomic persist → dashboard.

Success = a message sent from the client appears in the dashboard as a drafted quote (or an
escalation), produced by the live poll reading the real folder — with the agent able to do
**nothing but read** that one folder.

## Decisions (locked)

- Mailbox: `desk@linkport.example`, on Microsoft 365 / Exchange Online (real working inbox).
- Poll scope: **one folder only** ("Quote requests"); the agent never reads other mail.
- Auth: **client-credentials** (app-only), permission **`Mail.Read`** only, **scoped to the single
  mailbox** via an Exchange **Application Access Policy**.
- No send, no draft-back, no mailbox writes in Scope A. (`Mail.ReadWrite` / draft-back = follow-on.)
- Run target: local/dev smoke first; Trigger.dev **prod** deploy is a later increment.

## Current state — what already exists (reused unchanged)

- **`MailboxReader` port** — `listSince(cursor) → { messages, cursor }`
  ([packages/ingest/src/poll.ts:39](../../../packages/ingest/src/poll.ts)). The poll depends on this,
  not on Graph. **No new port is needed.**
- **`OutlookMailbox`** — the read-by-cursor + create-draft wrapper over a `GraphTransport` seam
  ([packages/graph/src/outlook.ts](../../../packages/graph/src/outlook.ts)). Already satisfies
  `MailboxReader`. We only add folder-scoping to its read path.
- **`StubGraphTransport` / `createStubMailbox`** — the fake we replace
  ([packages/ingest/src/stub-transport.ts](../../../packages/ingest/src/stub-transport.ts)).
- **The whole downstream** — `pollMailbox`, the durable `run-request` task, `persist_run_outcome`,
  the dashboard — is **untouched**. MS Graph's `receivedDateTime` is exactly the cursor `pollMailbox`
  already advances ([poll.ts:64](../../../packages/ingest/src/poll.ts)).
- **The swap point** — one line: `const mailbox = createStubMailbox();`
  ([packages/trigger/src/trigger/poll.ts:30](../../../packages/trigger/src/trigger/poll.ts)).

## What's new (3 small code units + 1 script)

1. **Folder-scoping on `OutlookMailbox`** — add a `folderId` constructor argument. When set,
   `listSince` reads `/users/{user}/mailFolders/{folderId}/messages` instead of `/users/{user}/messages`;
   the `$filter=receivedDateTime gt {cursor}`, `$orderby`, `$select`, `$top` and the `toInbound`
   mapping are unchanged. (Surgical change to the existing class.)

2. **`GraphFetchTransport`** (new, e.g. `packages/graph/src/graph-transport.ts`) — a real
   `GraphTransport` (`get`/`post`) over `fetch`:
   - acquires a token via client-credentials
     (`POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`, body
     `grant_type=client_credentials`, `scope=https://graph.microsoft.com/.default`,
     `client_id`, `client_secret`);
   - caches the token until ~60s before `expires_in`; re-uses it across calls;
   - `get(path)` → `GET https://graph.microsoft.com/v1.0{path}` with `Authorization: Bearer …`;
     non-2xx → throw (never silently return empty);
   - `post` exists to complete the seam but is unused in Scope A.

3. **`createOutlookMailboxFromEnv()`** (factory) — reads `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`,
   `GRAPH_CLIENT_SECRET`, `GRAPH_MAILBOX_USER`, `GRAPH_QUOTE_FOLDER`; throws if any is missing (mirrors
   `createServiceClient`); returns `new OutlookMailbox(new GraphFetchTransport(...), user, folder)`.

4. **Wire the factory into the scheduled task** — in `packages/trigger/src/trigger/poll.ts`, replace
   `createStubMailbox()` with: Graph env present → `createOutlookMailboxFromEnv()`; else the stub
   (so existing tests and the no-credentials path keep working).

5. **`scripts/graph_smoke.ts`** (new, not in CI) — two modes: (a) `--folders` lists the mailbox's
   `mailFolders` as `{id, displayName}` so the user can copy the "Quote requests" folder id into
   `GRAPH_QUOTE_FOLDER`; (b) default mode builds the live mailbox from env, calls
   `listSince("1970-01-01T00:00:00Z")` against that folder, and prints `{from, subject,
   receivedDateTime}` for each message. The human verification step after the Azure/Outlook setup.

## Data flow

```
client (alwyn0678@gmail) ──email──▶ desk@linkport.example inbox
                                        │  Outlook rule: from alwyn0678 → move to "Quote requests"
                                        ▼
                              "Quote requests" folder
                                        │  pollMailboxTask (cron */5) → GraphFetchTransport (Mail.Read)
                                        ▼
   pollMailbox: listSince(cursor) → insertReceived (dedup) → advance cursor → toRun[]
                                        │  batchTrigger runRequestTask
                                        ▼
   durable run: extract → gate → price → draft → persist_run_outcome (atomic)
                                        ▼
                                   dashboard
```

## Security posture

- **Read-only by permission.** Only `Mail.Read` is consented; the app cannot send, modify, move, or
  delete mail. `createDraft` (which needs `Mail.ReadWrite`) is not invoked in Scope A.
- **Single-mailbox blast radius.** Application permissions are tenant-wide by default; an **Exchange
  Application Access Policy** restricts this app to `desk@linkport.example` only, so it cannot read
  any other mailbox in the tenant.
- **Folder-scoped.** Even within that mailbox, the poll reads only the "Quote requests" folder.
- **Secrets** (`GRAPH_CLIENT_SECRET` et al.) live in `.env` (gitignored) locally and as Trigger.dev
  secrets later — never in the repo, never in chat, never in any browser bundle.

## Testing strategy

Per project norms: deterministic logic is unit-tested hermetically; the live path gets **one
documented, non-CI smoke check** (we never assert on live network in CI).

| AC | Behavior | Test |
|----|----------|------|
| AC-G1 | `GraphFetchTransport` attaches a Bearer token and **caches** it (no second token request within expiry). | hermetic, fake `fetch` |
| AC-G2 | A non-2xx Graph response is **thrown**, not swallowed as empty. | hermetic, fake `fetch` |
| AC-G3 | Folder-scoped `OutlookMailbox` reads `…/mailFolders/{id}/messages` and preserves the `receivedDateTime gt {cursor}` filter + `toInbound` mapping. | `outlook.test.ts` |
| AC-G4 | The poll factory selects the live mailbox when Graph env is present, else the stub. | factory unit test |
| AC-G5 | *(live, manual)* the smoke script lists the real folder; a test email from the client appears. | `scripts/graph_smoke.ts`, run by hand |

## Configuration (env)

```
GRAPH_TENANT_ID=…           # Entra tenant (directory) id
GRAPH_CLIENT_ID=…           # app (client) id
GRAPH_CLIENT_SECRET=…       # app client secret           (secret)
GRAPH_MAILBOX_USER=desk@linkport.example
GRAPH_QUOTE_FOLDER=…        # the "Quote requests" mailFolder *id* (a custom folder has no
                            # well-known name) — resolve it once via `graph_smoke.ts --folders`
```

## User setup (manual prerequisites — I provide exact steps)

1. **Entra app registration** → client id / secret / tenant id.
2. **API permission** `Mail.Read` (Application) → **Grant admin consent**.
3. **Application Access Policy** (Exchange Online PowerShell) → scope the app to
   `desk@linkport.example` only.
4. **Outlook**: create the **"Quote requests"** folder + a **rule** (from `alwyn0678@gmail.com` →
   move to that folder).
5. Put the first four values in `.env`; run `graph_smoke.ts --folders` to get the folder id for
   `GRAPH_QUOTE_FOLDER`; then run `graph_smoke.ts` and send a test email to verify.

## Task slices (supervised — one at a time, each its own branch/commit + test)

1. Folder-scoping on `OutlookMailbox` + `outlook.test.ts` (AC-G3).
2. `GraphFetchTransport` + hermetic test (AC-G1, AC-G2).
3. `createOutlookMailboxFromEnv` factory + wire into `trigger/poll.ts` + factory test (AC-G4).
4. `scripts/graph_smoke.ts` + the user-setup doc → *(user does Azure/Outlook setup)* → live smoke
   check (AC-G5) = verification.
5. *(later increment)* deploy the poll to Trigger.dev **prod** with the Graph secrets.

## Assumptions & caveats (technical — verify at smoke test; no freight-domain claims here)

- `desk@linkport.example` is on the same M365/Exchange Online tenant the user confirmed and is
  reachable via Graph `/users/{address}/…`.
- The Graph message JSON shape matches `toInbound`'s expectations (`from.emailAddress.address`,
  `body.content`, `receivedDateTime`). HTML-bodied mail yields HTML in `body.content`; the agent's
  extraction already tolerates this (the stub corpus is plain text — confirm at smoke test).
- An Application Access Policy can take up to ~30 minutes to take effect after creation.

## Out of scope (explicitly deferred)

- **Scope B** — draft-back into Outlook (`Mail.ReadWrite`, `createDraft`, approve-flow change).
- **Trigger.dev prod** continuous polling (task slice 5; dev/local smoke proves it first).
- **Gmail sibling** — a second `MailboxReader` implementation behind the same port (documented as
  zero-rework future work; not built now).
- **Multi-mailbox / multi-tenant poll** — the poll stays single-tenant for the demo.
