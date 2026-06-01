import Link from "next/link";
import type { ReactNode } from "react";

export type Tab = "inbox" | "quotes" | "archive" | "usage";
const NAV: { tab: Tab; href: string; label: string }[] = [
  { tab: "inbox", href: "/", label: "Inbox" },
  { tab: "quotes", href: "/quotes", label: "Quotations" },
  { tab: "archive", href: "/archive", label: "Archive" },
  { tab: "usage", href: "/usage", label: "Usage" },
];

export function AppShell({
  active,
  userEmail,
  title,
  subtitle,
  counts,
  children,
}: {
  active: Tab;
  userEmail: string;
  title: string;
  subtitle?: string;
  counts?: Partial<Record<Tab, number>>;
  children: ReactNode;
}) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="anchor" aria-hidden>
            ⚓
          </div>
          <div className="word">
            Linkport<span>Forwarders</span>
          </div>
        </div>
        <nav className="nav">
          <div className="lbl">Quote desk</div>
          {NAV.map((n) => {
            const c = counts?.[n.tab];
            return (
              <Link key={n.tab} href={n.href} className={n.tab === active ? "on" : ""}>
                <span>{n.label}</span>
                {c ? <span className="pip">{c}</span> : null}
              </Link>
            );
          })}
        </nav>
        <div className="who">
          <div className="live">
            <span className="dot" aria-hidden /> Agent online
          </div>
          <span className="email">{userEmail}</span>
          <form action="/auth/signout" method="post">
            <button type="submit">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="main">
        <header className="top">
          <div>
            <h1>{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
        </header>
        <div className="pane">{children}</div>
      </main>
    </div>
  );
}
