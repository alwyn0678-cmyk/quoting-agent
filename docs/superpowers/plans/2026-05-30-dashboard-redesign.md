# Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat request list with a two-pane "Workbench" reviewer dashboard — a navy Maritime shell + strict-split **Inbox** (`/`) and **Quotations** (`/quotes`) tabs, server-rendered with `?sel=` selection.

**Architecture:** New presentational server components under `apps/web/app/components/` (`AppShell`, `StatusBadge`, `RequestList`, `EmailDetail`, `QuoteDetail`). Pages fetch RLS-scoped requests, map them to list rows, and render the selected row's detail. A surgical data-layer change adds the email `body` + a `quotationsOnly` filter. `globals.css` is reworked into a light Maritime token system.

**Tech Stack:** Next.js 16 App Router (server components), React 19, Supabase SSR, vitest, hand-rolled token CSS.

---

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `apps/web/src/lib/dashboard.ts` | modify | Add `body` + pure `quotationsOnly()` |
| `apps/web/src/lib/dashboard.test.ts` | modify | Test `body` mapping + `quotationsOnly` |
| `apps/web/app/components/AppShell.tsx` | create | Sidebar + nav + topbar + pane slot |
| `apps/web/app/components/StatusBadge.tsx` | create | status → chip |
| `apps/web/app/components/RequestList.tsx` | create | List column (rows → `<Link>` + badge) |
| `apps/web/app/components/EmailDetail.tsx` | create | Inbox detail (the raw email) |
| `apps/web/app/components/QuoteDetail.tsx` | create | Quotations detail (breakdown + draft + Approve) |
| `apps/web/app/page.tsx` | rewrite | Inbox page (two-pane, `?sel`) |
| `apps/web/app/quotes/page.tsx` | create | Quotations page (two-pane, `?sel`) |
| `apps/web/app/actions.ts` | modify | `revalidatePath("/quotes")` too |
| `apps/web/app/usage/page.tsx` | modify | Wrap in `AppShell` |
| `apps/web/app/globals.css` | rewrite | Light Maritime token system |

**Verification boundaries.** Data layer (`src/lib`): `npm test` + `npm run typecheck` (root). Components/pages (`app/`): `npm --prefix apps/web run typecheck` and `npm --prefix apps/web run build` (the root typecheck excludes `apps/web/app`). Visual fidelity is verified by eye later (and in the deferred live check), not by a test.

---

## Task 1: Data layer — `body` + `quotationsOnly`

**Files:**
- Modify: `apps/web/src/lib/dashboard.ts`
- Test: `apps/web/src/lib/dashboard.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the `describe("P-1C.3 — dashboard render model", …)` block in `apps/web/src/lib/dashboard.test.ts` (and add the import at the top: `import { buildRequestView, quotationsOnly, type RawRequestRow, type RequestView } from "./dashboard.js";`):

```ts
  it("AC-D1: carries the inbound email body into the view", async () => {
    const row: RawRequestRow = {
      id: "rb",
      status: "awaiting_review",
      from_email: "maria@apex.example",
      subject: "Quote RTM->NYC",
      body: "Dear Linkport, please quote 2 x 40HC Rotterdam to New York.",
      created_at: "2026-05-20T10:00:00Z",
      escalation_reason: null,
      injection_flag: false,
      quotes: [],
      drafts: [],
    };
    expect(buildRequestView(row).body).toBe(
      "Dear Linkport, please quote 2 x 40HC Rotterdam to New York.",
    );
  });

  it("AC-D2: quotationsOnly keeps views with a quote, drops escalations", () => {
    const base = {
      created_at: "2026-05-20T10:00:00Z",
      injection_flag: false,
      body: "b",
    };
    const quoted: RequestView = {
      id: "q1",
      status: "awaiting_review",
      from_email: "a@x.example",
      subject: "s",
      escalation_reason: null,
      quote: {
        lane: "NLRTM-USNYC",
        container_type: "40HC",
        container_qty: 1,
        base_per_container: 2550,
        surcharges: [],
        per_shipment_fees: [],
        all_in_total: 3520,
        validity_through: "2026-06-30",
        rate_card_version: "2026-06-v1",
      },
      draft: null,
      ...base,
    };
    const escalated: RequestView = {
      id: "e1",
      status: "escalated",
      from_email: "b@y.example",
      subject: "s2",
      escalation_reason: "out_of_scope_mode",
      quote: null,
      draft: null,
      ...base,
    };
    expect(quotationsOnly([quoted, escalated]).map((v) => v.id)).toEqual(["q1"]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/web/src/lib/dashboard.test.ts -t "AC-D"`
Expected: FAIL — `RawRequestRow`/`RequestView` have no `body`; `quotationsOnly` is not exported.

- [ ] **Step 3: Add `body` and `quotationsOnly` to `dashboard.ts`**

In `apps/web/src/lib/dashboard.ts`:

Add `body` to `RequestView` (after `subject`):
```ts
  subject: string | null;
  body: string | null;
```

Add `body` to `RawRequestRow` (after `subject`):
```ts
  subject: string | null;
  body: string | null;
```

Map it in `buildRequestView` (after `subject: row.subject,`):
```ts
    subject: row.subject,
    body: row.body,
```

Add `body` to the `SELECT` string:
```ts
const SELECT =
  "id, status, from_email, subject, body, created_at, escalation_reason, injection_flag, quotes(breakdown_snapshot), drafts(subject, body, simulated_sent_at)";
```

Add the filter at the end of the file:
```ts
/** The requests that produced a quote — the Quotations tab list (escalations are Inbox-only). */
export function quotationsOnly(views: RequestView[]): RequestView[] {
  return views.filter((v) => v.quote !== null);
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run apps/web/src/lib/dashboard.test.ts` → Expected: PASS (all, including the new two).
Run: `npm run typecheck` → Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/dashboard.ts apps/web/src/lib/dashboard.test.ts
git commit -m "feat(web): dashboard data layer — email body + quotationsOnly filter"
```

---

## Task 2: `AppShell` + `StatusBadge`

**Files:**
- Create: `apps/web/app/components/StatusBadge.tsx`
- Create: `apps/web/app/components/AppShell.tsx`

- [ ] **Step 1: Create `StatusBadge.tsx`**

```tsx
const LABELS: Record<string, { cls: string; text: string }> = {
  awaiting_review: { cls: "await", text: "Awaiting" },
  escalated: { cls: "esc", text: "Escalated" },
  sent: { cls: "sent", text: "Sent" },
};

export function StatusBadge({ status }: { status: string }) {
  const m = LABELS[status] ?? { cls: "await", text: status.replace(/_/g, " ") };
  return <span className={`chip ${m.cls}`}>{m.text}</span>;
}
```

- [ ] **Step 2: Create `AppShell.tsx`**

```tsx
import Link from "next/link";
import type { ReactNode } from "react";

type Tab = "inbox" | "quotes" | "usage";
const NAV: { tab: Tab; href: string; label: string }[] = [
  { tab: "inbox", href: "/", label: "Inbox" },
  { tab: "quotes", href: "/quotes", label: "Quotations" },
  { tab: "usage", href: "/usage", label: "Usage" },
];

export function AppShell({
  active,
  userEmail,
  title,
  subtitle,
  children,
}: {
  active: Tab;
  userEmail: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          Linkport<span>Forwarders</span>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <Link key={n.tab} href={n.href} className={n.tab === active ? "on" : ""}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="who">
          <span className="email">{userEmail}</span>
          <form action="/auth/signout" method="post">
            <button type="submit">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="main">
        <header className="top">
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </header>
        <div className="pane">{children}</div>
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm --prefix apps/web run typecheck`
Expected: clean (components compile; unused until the pages import them is fine).

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/StatusBadge.tsx apps/web/app/components/AppShell.tsx
git commit -m "feat(web): AppShell + StatusBadge components"
```

---

## Task 3: `RequestList` + `EmailDetail` + Inbox page

**Files:**
- Create: `apps/web/app/components/RequestList.tsx`
- Create: `apps/web/app/components/EmailDetail.tsx`
- Rewrite: `apps/web/app/page.tsx`

- [ ] **Step 1: Create `RequestList.tsx`**

```tsx
import Link from "next/link";
import { StatusBadge } from "./StatusBadge";

export interface RowItem {
  id: string;
  title: string;
  subtitle: string;
  status: string;
  amount?: string;
}

export function RequestList({
  rows,
  selectedId,
  hrefBase,
}: {
  rows: RowItem[];
  selectedId: string | null;
  hrefBase: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="list">
        <div className="emptylist">Nothing here yet.</div>
      </div>
    );
  }
  return (
    <div className="list">
      {rows.map((r) => (
        <Link
          key={r.id}
          href={`${hrefBase}?sel=${r.id}`}
          className={`row ${r.id === selectedId ? "sel" : ""}`}
        >
          <div className="nm">{r.title}</div>
          <div className="sub">{r.subtitle}</div>
          <div className="meta">
            {r.amount ? <span className="amt">{r.amount}</span> : <span />}
            <StatusBadge status={r.status} />
          </div>
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create `EmailDetail.tsx`**

```tsx
import Link from "next/link";
import type { RequestView } from "../../src/lib/dashboard";
import { StatusBadge } from "./StatusBadge";

const REASON_LABELS: Record<string, string> = {
  missing_required_field: "Missing a required field",
  out_of_scope_lane: "Lane not in the rate card",
  out_of_scope_mode: "Mode not supported (FCL only)",
  ambiguous_request: "Ambiguous request",
  low_confidence: "Low extraction confidence",
  guard_violation: "Safety guard tripped — failed closed",
};

const eur = (n: number) => `EUR ${n.toLocaleString("en-US")}`;

export function EmailDetail({ r }: { r: RequestView }) {
  return (
    <div className="detail">
      <div className="dhdr">
        From <b>{r.from_email ?? "(unknown sender)"}</b>
        {" · "}
        {new Date(r.created_at).toLocaleString("en-GB", { timeZone: "UTC" })} UTC{" "}
        <StatusBadge status={r.status} />
      </div>
      <h2 className="dsubj">{r.subject ?? "(no subject)"}</h2>
      <div className="emailbox">{r.body ?? "(no message body)"}</div>

      {r.injection_flag ? (
        <div className="flagnote">
          The sender&apos;s message contained text resembling an injection attempt. The price is
          computed by code (not the model) and the safety guard passed — review before approving.
        </div>
      ) : null}

      {r.quote ? (
        <Link className="outcome" href={`/quotes?sel=${r.id}`}>
          <span>✅ Agent priced this — all-in {eur(r.quote.all_in_total)}</span>
          <span className="go">View quotation →</span>
        </Link>
      ) : (
        <div className="escalation">
          <strong>
            Escalated
            {r.escalation_reason
              ? ` — ${REASON_LABELS[r.escalation_reason] ?? r.escalation_reason}`
              : ""}
            .
          </strong>{" "}
          Needs a human; no reply can be sent from here.
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `apps/web/app/page.tsx` (Inbox)**

```tsx
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../lib/supabase/server";
import { listRequestsForTenant } from "../src/lib/dashboard";
import { AppShell } from "./components/AppShell";
import { RequestList, type RowItem } from "./components/RequestList";
import { EmailDetail } from "./components/EmailDetail";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ sel?: string }>;
}) {
  const { sel } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const requests = await listRequestsForTenant(supabase);
  const selected = requests.find((r) => r.id === sel) ?? null;
  const rows: RowItem[] = requests.map((r) => ({
    id: r.id,
    title: r.from_email ?? "(unknown sender)",
    subtitle: r.subject ?? "(no subject)",
    status: r.status,
  }));
  const awaiting = requests.filter((r) => r.status === "awaiting_review").length;

  return (
    <AppShell
      active="inbox"
      userEmail={user.email ?? ""}
      title="Inbox"
      subtitle={`${requests.length} request${requests.length === 1 ? "" : "s"} · ${awaiting} awaiting review`}
    >
      <RequestList rows={rows} selectedId={sel ?? null} hrefBase="/" />
      {selected ? (
        <EmailDetail r={selected} />
      ) : (
        <div className="detail empty">Select a request to view the email.</div>
      )}
    </AppShell>
  );
}
```

- [ ] **Step 4: Typecheck + build**

Run: `npm --prefix apps/web run typecheck` → Expected: clean.
Run: `npm --prefix apps/web run build` → Expected: builds (the `/` route compiles; `/quotes` arrives in Task 4).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/RequestList.tsx apps/web/app/components/EmailDetail.tsx apps/web/app/page.tsx
git commit -m "feat(web): Inbox tab — RequestList + EmailDetail two-pane"
```

---

## Task 4: `QuoteDetail` + Quotations page + revalidate

**Files:**
- Create: `apps/web/app/components/QuoteDetail.tsx`
- Create: `apps/web/app/quotes/page.tsx`
- Modify: `apps/web/app/actions.ts`

- [ ] **Step 1: Create `QuoteDetail.tsx`**

```tsx
import type { RequestView } from "../../src/lib/dashboard";
import { approveAction } from "../actions";

const eur = (n: number) => `EUR ${n.toLocaleString("en-US")}`;

export function QuoteDetail({ r }: { r: RequestView }) {
  const q = r.quote;
  if (!q) return null; // the Quotations page only passes quoted requests
  return (
    <div className="detail">
      <div className="dhdr">
        {q.lane} · {q.container_qty} × {q.container_type} · card {q.rate_card_version} · valid through{" "}
        {q.validity_through}
      </div>
      <h2 className="dsubj">All-in quote — {eur(q.all_in_total)}</h2>

      <div className="brk">
        <div className="ln">
          <span className="c">Base (per container)</span>
          <span>{eur(q.base_per_container)}</span>
        </div>
        {q.surcharges.map((s) => (
          <div className="ln" key={s.code}>
            <span className="c">{s.code} (per container)</span>
            <span>{eur(s.amount_per_container)}</span>
          </div>
        ))}
        {q.per_shipment_fees.map((f) => (
          <div className="ln" key={f.code}>
            <span className="c">{f.code} (per shipment)</span>
            <span>{eur(f.amount)}</span>
          </div>
        ))}
        <div className="ln tot">
          <span className="c">All-in total</span>
          <span>{eur(q.all_in_total)}</span>
        </div>
      </div>

      {r.draft ? (
        <div className="draft">
          <div className="ds">{r.draft.subject}</div>
          <div className="db">{r.draft.body}</div>
        </div>
      ) : null}

      {r.status === "awaiting_review" ? (
        <form action={approveAction} className="approve">
          <input type="hidden" name="requestId" value={r.id} />
          <button type="submit" className="btn">
            Approve &amp; simulate send
          </button>
        </form>
      ) : null}

      {r.status === "sent" ? (
        <div className="sentinfo">
          ✓ Simulated send
          {r.draft?.simulated_sent_at
            ? ` · ${new Date(r.draft.simulated_sent_at).toLocaleString("en-GB", { timeZone: "UTC" })} UTC`
            : ""}{" "}
          — no email was actually sent (Graph send is not wired; R1).
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Create `apps/web/app/quotes/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { listRequestsForTenant, quotationsOnly } from "../../src/lib/dashboard";
import { AppShell } from "../components/AppShell";
import { RequestList, type RowItem } from "../components/RequestList";
import { QuoteDetail } from "../components/QuoteDetail";

export const dynamic = "force-dynamic";

const eur = (n: number) => `EUR ${n.toLocaleString("en-US")}`;

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ sel?: string }>;
}) {
  const { sel } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const quotes = quotationsOnly(await listRequestsForTenant(supabase));
  const selected = quotes.find((r) => r.id === sel) ?? null;
  const rows: RowItem[] = quotes.map((r) => ({
    id: r.id,
    title: r.from_email ?? "(unknown sender)",
    subtitle: r.quote ? `${r.quote.lane} · ${r.quote.container_qty}×${r.quote.container_type}` : "",
    status: r.status,
    amount: r.quote ? eur(r.quote.all_in_total) : undefined,
  }));
  const awaiting = quotes.filter((r) => r.status === "awaiting_review").length;

  return (
    <AppShell
      active="quotes"
      userEmail={user.email ?? ""}
      title="Quotations"
      subtitle={`${quotes.length} quote${quotes.length === 1 ? "" : "s"} · ${awaiting} awaiting review`}
    >
      <RequestList rows={rows} selectedId={sel ?? null} hrefBase="/quotes" />
      {selected ? (
        <QuoteDetail r={selected} />
      ) : (
        <div className="detail empty">Select a quotation to review.</div>
      )}
    </AppShell>
  );
}
```

- [ ] **Step 3: Update `actions.ts` to revalidate both tabs**

Replace `revalidatePath("/");` (the last line of `approveAction`) with:
```ts
  revalidatePath("/");
  revalidatePath("/quotes");
```

- [ ] **Step 4: Typecheck + build**

Run: `npm --prefix apps/web run typecheck` → Expected: clean.
Run: `npm --prefix apps/web run build` → Expected: both `/` and `/quotes` compile.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/QuoteDetail.tsx apps/web/app/quotes/page.tsx apps/web/app/actions.ts
git commit -m "feat(web): Quotations tab — QuoteDetail + /quotes + revalidate both tabs"
```

---

## Task 5: `globals.css` — light Maritime token system

**Files:**
- Rewrite: `apps/web/app/globals.css`

This re-themes everything (shell, list, detail, chips) and **keeps** the usage + login classes (re-skinned via tokens) so those pages don't break. Login is untouched — it inherits the new tokens.

- [ ] **Step 1: Replace the entire contents of `apps/web/app/globals.css`**

```css
:root {
  --navy: #0f2540;
  --navy-2: #13324d;
  --teal: #0d9488;
  --teal-soft: #ecfbf8;
  --teal-border: #b6e7df;
  --bg: #f4f7f9;
  --surface: #ffffff;
  --surface-2: #f9fbfc;
  --ink: #0f2540;
  --text: #1f2937;
  --muted: #64748b;
  --border: #e3e9ee;
  --await: #0f766e;
  --await-bg: #e6f7f4;
  --esc: #b45309;
  --esc-bg: #fef3e2;
  --sent: #475569;
  --sent-bg: #eef2f7;
  --danger: #b91c1c;
  --radius: 10px;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 14px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
a { color: var(--teal); text-decoration: none; }

/* ---- App shell ---- */
.shell { display: flex; min-height: 100vh; }

.sidebar {
  width: 220px; flex-shrink: 0; background: var(--navy); color: #9fb3c8;
  display: flex; flex-direction: column; padding: 18px 14px;
}
.brand { color: #fff; font-weight: 800; font-size: 18px; letter-spacing: 0.2px; }
.brand span {
  display: block; color: #6c8199; font-weight: 500; font-size: 11px;
  letter-spacing: 0.5px; text-transform: uppercase; margin-top: 3px;
}
.nav { margin-top: 22px; display: flex; flex-direction: column; gap: 4px; }
.nav a { padding: 9px 11px; border-radius: 8px; color: #9fb3c8; font-weight: 500; }
.nav a:hover { background: var(--navy-2); color: #cdd9e4; }
.nav a.on { background: var(--navy-2); color: #fff; box-shadow: inset 3px 0 0 var(--teal); }
.who { margin-top: auto; border-top: 1px solid #1c3a57; padding-top: 14px; font-size: 12px; color: #7e93a8; }
.who .email { display: block; color: #cdd9e4; font-weight: 600; margin-bottom: 8px; word-break: break-all; }
.who button { background: none; border: 1px solid #2c4a67; color: #9fb3c8; border-radius: 7px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
.who button:hover { border-color: var(--teal); color: #fff; }

.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.top { padding: 16px 22px; border-bottom: 1px solid var(--border); background: var(--surface); }
.top h1 { margin: 0; font-size: 19px; color: var(--ink); font-weight: 700; }
.top p { margin: 3px 0 0; font-size: 12px; color: var(--muted); }
.pane { flex: 1; display: flex; min-height: 0; }

/* ---- List column ---- */
.list { width: 300px; flex-shrink: 0; border-right: 1px solid var(--border); background: var(--surface); overflow: auto; }
.emptylist { padding: 28px 16px; color: var(--muted); font-size: 13px; }
.row { display: block; padding: 12px 14px; border-bottom: 1px solid #eef2f5; color: inherit; }
.row:hover { background: var(--surface-2); }
.row.sel { background: var(--teal-soft); box-shadow: inset 3px 0 0 var(--teal); }
.row .nm { font-weight: 600; color: var(--ink); font-size: 13px; }
.row .sub { color: var(--muted); font-size: 12px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row .meta { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
.row .amt { font-weight: 800; color: var(--ink); font-size: 13px; }

/* ---- Status chips ---- */
.chip { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; padding: 3px 9px; border-radius: 20px; }
.chip.await { background: var(--await-bg); color: var(--await); }
.chip.esc { background: var(--esc-bg); color: var(--esc); }
.chip.sent { background: var(--sent-bg); color: var(--sent); }

/* ---- Detail pane ---- */
.detail { flex: 1; padding: 22px; overflow: auto; background: var(--surface-2); }
.detail.empty { color: var(--muted); display: flex; align-items: center; justify-content: center; }
.dhdr { font-size: 12px; color: var(--muted); margin-bottom: 4px; }
.dhdr b { color: var(--ink); }
.dsubj { margin: 0 0 14px; font-size: 17px; color: var(--ink); font-weight: 700; }
.emailbox { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; font-size: 13px; color: #374151; line-height: 1.6; white-space: pre-wrap; }

.outcome { margin-top: 14px; display: flex; justify-content: space-between; align-items: center; background: var(--teal-soft); border: 1px solid var(--teal-border); border-radius: var(--radius); padding: 12px 14px; font-size: 13px; color: var(--await); }
.outcome .go { color: var(--teal); font-weight: 700; }
.escalation { margin-top: 14px; background: var(--surface); border: 1px solid var(--esc-bg); border-left: 3px solid var(--esc); border-radius: var(--radius); padding: 12px 14px; font-size: 13px; color: var(--text); }
.escalation strong { color: var(--esc); }
.flagnote { margin-top: 14px; background: #fffaf0; border: 1px solid #f5d99b; border-radius: var(--radius); padding: 10px 14px; font-size: 12px; color: #92600a; }

/* ---- Quote breakdown ---- */
.brk { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.brk .ln { display: flex; justify-content: space-between; padding: 8px 14px; font-size: 13px; border-bottom: 1px solid #f0f3f6; font-variant-numeric: tabular-nums; }
.brk .ln .c { color: var(--muted); }
.brk .ln.tot { background: var(--navy); color: #fff; font-weight: 800; border-bottom: none; }
.brk .ln.tot .c { color: #9fd8d0; }

.draft { margin-top: 14px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; }
.draft .ds { font-weight: 700; color: var(--ink); margin-bottom: 8px; font-size: 13px; }
.draft .db { white-space: pre-wrap; font-size: 13px; color: #374151; line-height: 1.55; }

.approve { margin-top: 14px; }
.btn { background: var(--teal); border: none; border-radius: 8px; padding: 9px 16px; color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; }
.btn:hover { filter: brightness(1.06); }
.sentinfo { margin-top: 14px; font-size: 12px; color: var(--await); }

/* ---- Usage page (in-shell) ---- */
.usagewrap { flex: 1; padding: 22px; overflow: auto; }
.totals { display: flex; gap: 12px; margin-bottom: 22px; flex-wrap: wrap; }
.stat { flex: 1 1 140px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px 18px; }
.statn { font-size: 22px; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
.statl { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; margin-top: 4px; }
table.usage { width: 100%; border-collapse: collapse; font-size: 13px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
table.usage th, table.usage td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
table.usage th { color: var(--muted); font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 0.04em; }
table.usage .num { text-align: right; font-variant-numeric: tabular-nums; }
table.usage .model { color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.badge { font-size: 11px; padding: 3px 8px; border-radius: 999px; border: 1px solid var(--border); color: var(--muted); white-space: nowrap; }
.costnote { color: var(--muted); font-size: 12px; margin-top: 18px; }
.empty { color: var(--muted); text-align: center; padding: 48px 0; }

/* ---- Login (untouched markup; re-themed via tokens) ---- */
.login { max-width: 360px; margin: 14vh auto 0; padding: 0 20px; }
.login h1 { font-size: 20px; margin: 0 0 6px; color: var(--ink); }
.login p { color: var(--muted); font-size: 13px; margin: 0 0 22px; }
.login form { display: flex; flex-direction: column; gap: 10px; }
.login input { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 11px 12px; color: var(--text); font-size: 15px; }
.login button { background: var(--teal); border: none; border-radius: 8px; padding: 11px 12px; color: #fff; font-size: 15px; font-weight: 700; cursor: pointer; }
.login button:disabled { opacity: 0.6; cursor: default; }
.notice { margin-top: 16px; font-size: 14px; }
.notice.ok { color: var(--await); }
.notice.err { color: var(--danger); }
```

- [ ] **Step 2: Typecheck + build**

Run: `npm --prefix apps/web run build`
Expected: builds clean (CSS is not typechecked; this confirms nothing import-broke).

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/globals.css
git commit -m "feat(web): globals.css — light Maritime token system"
```

---

## Task 6: Usage page → `AppShell`

**Files:**
- Modify: `apps/web/app/usage/page.tsx`

- [ ] **Step 1: Rewrite `usage/page.tsx` to render inside the shell**

Replace the whole `return (...)` block (and add the import `import { AppShell } from "../components/AppShell";` at the top) so the totals + table sit in the shell's pane:

```tsx
  return (
    <AppShell
      active="usage"
      userEmail={user.email ?? ""}
      title="Usage & cost"
      subtitle="Token + estimated cost per agent run (audit log)"
    >
      <div className="usagewrap">
        <div className="totals">
          <div className="stat">
            <div className="statn">{usage.totals.runs}</div>
            <div className="statl">runs</div>
          </div>
          <div className="stat">
            <div className="statn">{fmt(usage.totals.input_tokens)}</div>
            <div className="statl">input tokens</div>
          </div>
          <div className="stat">
            <div className="statn">{fmt(usage.totals.output_tokens)}</div>
            <div className="statl">output tokens</div>
          </div>
          <div className="stat">
            <div className="statn">{usd(usage.totals.est_cost_usd)}</div>
            <div className="statl">est. cost</div>
          </div>
        </div>

        {usage.rows.length === 0 ? (
          <div className="empty">No usage recorded yet.</div>
        ) : (
          <table className="usage">
            <thead>
              <tr>
                <th>When (UTC)</th>
                <th>Event</th>
                <th>Model(s)</th>
                <th className="num">In</th>
                <th className="num">Out</th>
                <th className="num">Est. cost</th>
              </tr>
            </thead>
            <tbody>
              {usage.rows.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.created_at).toLocaleString("en-GB", { timeZone: "UTC" })}</td>
                  <td>
                    <span className={`badge ${r.event}`}>{r.event}</span>
                  </td>
                  <td className="model">{r.model}</td>
                  <td className="num">{fmt(r.input_tokens)}</td>
                  <td className="num">{fmt(r.output_tokens)}</td>
                  <td className="num">{usd(r.est_cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="costnote">
          Estimated cost uses placeholder per-token prices (ASSUMPTIONS E3) — directional, not billing.
        </p>
      </div>
    </AppShell>
  );
```

Remove the now-unused `import Link from "next/link";` line at the top of the file (the old "← Requests" link is gone — the shell nav replaces it).

- [ ] **Step 2: Typecheck + build**

Run: `npm --prefix apps/web run typecheck` → Expected: clean (no unused `Link`).
Run: `npm --prefix apps/web run build` → Expected: all routes (`/`, `/quotes`, `/usage`, `/login`) build clean.

- [ ] **Step 3: Full root suite (nothing downstream changed)**

Run: `npm test` → Expected: all pass (incl. the new dashboard tests).

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/usage/page.tsx
git commit -m "feat(web): usage page in the AppShell"
```

---

## Deferred (not in this plan)
- UX **polish pass** ("make it pretty") — refine once the structure is in.
- Live verification (V5) — batched with the other live tests at the end.

---

## Self-Review

**Spec coverage:**
- AppShell + nav (spec "Shell & nav") → Task 2.
- Routes `/` Inbox + `/quotes` + `?sel` selection (spec "Routes") → Tasks 3, 4.
- Inbox detail = email (spec "Inbox detail") → Task 3 (`EmailDetail`).
- Quotations detail = breakdown + draft + Approve (spec "Quotations detail") → Task 4 (`QuoteDetail`).
- Data layer `body` + `quotationsOnly` (spec "Data layer"; AC-D1/AC-D2) → Task 1.
- `globals.css` token system (spec "Styling") → Task 5.
- Usage restyled into shell → Task 6.
- `approveAction` relocated + unchanged logic; revalidate both tabs → Task 4. ✓
- Standalone-build decoupling preserved (no cross-package type import added; components import only `RequestView` from `apps/web/src/lib/dashboard`) → Tasks 3, 4. ✓

**Placeholder scan:** none — every step shows complete code; the CSS is complete.

**Type consistency:** `RowItem` (`id/title/subtitle/status/amount?`) defined in Task 3 (`RequestList`) and produced identically in Tasks 3 + 4. `RequestView` (with the new `body`) from Task 1 is consumed by `EmailDetail`/`QuoteDetail` (Tasks 3/4). `AppShell` props (`active/userEmail/title/subtitle/children`) match every call site. `StatusBadge`’s chip classes (`await/esc/sent`) match `globals.css` Task 5. `quotationsOnly` (Task 1) is used in Task 4. ✓
