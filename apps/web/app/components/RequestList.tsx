import Link from "next/link";
import { StatusBadge } from "./StatusBadge";

export interface RowItem {
  id: string;
  title: string;
  subtitle: string;
  status: string;
  amount?: string;
  flag?: boolean;
  archived?: boolean;
}

/** First alphanumeric of the sender name/address — a compact avatar glyph. */
function initial(s: string): string {
  const name = s.replace(/<[^>]*>/, "").trim() || s;
  const m = name.match(/[A-Za-z0-9]/);
  return (m ? m[0] : "?").toUpperCase();
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
          <div className="top-ln">
            <span className="ava" aria-hidden>
              {initial(r.title)}
            </span>
            <span className="nm">{r.title}</span>
          </div>
          <div className="sub">{r.subtitle}</div>
          <div className="meta">
            {r.amount ? <span className="amt">{r.amount}</span> : <span />}
            <span className="badges">
              {r.flag ? (
                <span className="flagmark" title="injection flagged">
                  ⚠
                </span>
              ) : null}
              {r.archived ? <span className="chip arch">Archived</span> : null}
              <StatusBadge status={r.status} />
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}
