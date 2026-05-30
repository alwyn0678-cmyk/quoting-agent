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
