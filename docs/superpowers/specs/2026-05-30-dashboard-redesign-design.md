# Spec — Dashboard redesign (Q4): Workbench + strict-split tabs

- **Date:** 2026-05-30
- **Status:** approved design (visual mockup signed off), pre-implementation
- **Workstream:** Q4 (dashboard redesign)
- **Scope:** `apps/web` only

## Goal

Replace the single flat list ([apps/web/app/page.tsx](../../../apps/web/app/page.tsx)) with a
**Workbench** two-pane reviewer dashboard: a navy "Maritime" app shell + two **strict-split** tabs —
**Inbox** (the customer's inbound email) and **Quotations** (the agent's quote + draft + Approve).
This delivers the functional structure + a clean token-based baseline; a visual-polish pass is an
explicit follow-on (below).

## Decisions (locked — mockup approved by the user)

- Layout: **Workbench** (sidebar + list column + detail pane).
- Theme: **Maritime** — navy sidebar (`#0f2540`), teal accent (`#0d9488`), white content.
- Styling: **token-based custom CSS** (rework `globals.css`; no new dependencies).
- Tabs: **strict split** — Inbox = the email; Quotations = breakdown + draft + Approve.

## Architecture

- **`AppShell`** — navy sidebar (Linkport wordmark · nav `Inbox / Quotations / Usage` · signed-in user +
  Sign out pinned to the bottom) + a main content area. Wraps the three authenticated pages; `/login`
  stays outside it.
- **Routes (the tabs):** `/` Inbox · `/quotes` Quotations · `/usage` (restyled into the shell). Each is a
  server component: auth (redirect to `/login` if no user) → fetch (RLS-scoped) → render `AppShell` +
  the two-pane.
- **Selection:** a `?sel=<requestId>` search param. List rows are `<Link href="?sel=id">`; the server
  renders the selected row's detail; an empty-state prompt shows when nothing is selected. **No client
  JS** — stays server-rendered and RLS-scoped (no tenant filter in code — AC-5 preserved).
- **Standalone build preserved:** keep the inline `QuoteSnapshot` decoupling (no cross-package type
  import) so Vercel `root = apps/web` still builds.

## Components (focused files, `apps/web/app/components/`)

- `AppShell.tsx` — the shell (props: `active` tab, `userEmail`, `children`).
- `RequestList.tsx` — list rows (props: `items`, `selectedId`, `hrefBase`); each row = sender · subject ·
  status chip · (figure for quotes).
- `StatusBadge.tsx` — status → chip (awaiting / escalated / sent) + the injection-flag mark.
- `EmailDetail.tsx` — Inbox detail: from · subject · received · status · the **full email body** · the
  injection note if flagged · a "View quotation →" link to `/quotes?sel=id` when a quote exists; the
  escalation reason when escalated.
- `QuoteDetail.tsx` — Quotations detail: lane/containers header · the **Breakdown** (moved out of
  `page.tsx`) · the drafted reply · the **Approve & simulate send** form (`approveAction`, unchanged).

## Data layer (`apps/web/src/lib/dashboard.ts`) — surgical

- Add `body` to the `SELECT` string + `RequestView.body: string | null`; `buildRequestView` maps it
  (the Inbox needs the raw email; everything else is already joined).
- Add pure `quotationsOnly(views: RequestView[]): RequestView[]` → the views with `quote != null` (the
  Quotations list).
- Everything else (RLS scoping, the `breakdown_snapshot` derivation, the structural `RequestsReader`) is
  unchanged.

## Styling (`apps/web/app/globals.css`) — token system

- `:root` variables: the Maritime palette (`--navy`, `--teal`, `--teal-ink`, `--ink`, `--muted`,
  `--surface`, `--bg`, `--border`), a spacing scale, radii, a type scale.
- Component classes built on those tokens (shell · sidebar · nav · list · row · chip · detail · emailbox ·
  breakdown · draft · btn), replacing the current ad-hoc classes. One stylesheet, no new dependencies,
  Vercel build unchanged.

## Testing (per project norms)

- **AC-D1:** `buildRequestView` carries `body` from the row → unit test.
- **AC-D2:** `quotationsOnly` returns only views with a non-null `quote` → unit test.
- Extend [apps/web/src/lib/dashboard.test.ts](../../../apps/web/src/lib/dashboard.test.ts); the existing
  `buildRequestView` / RLS tests stay green.
- Visual fidelity is a **design deliverable verified by eye** (mockup approved; live check deferred), NOT
  a pass/fail AC — consistent with "if it can't be a test, it's not a criterion."
- `approveAction` logic is **unchanged** (relocated into `QuoteDetail`); its existing test stays green.

## Deferred (explicit follow-ons — not this build)

- **UX polish pass** ("make it pretty") — spacing / visual-delight refinements AFTER this functional
  structure lands (the user's stated intent).
- **Live verification** (V5 dashboard check) — batched with the other live tests at the end of the project.

## Out of scope

- The autonomous pipeline, DB schema, and Graph poll — untouched.
- No new data is persisted; the Inbox shows the email already stored, just newly selected/displayed.
