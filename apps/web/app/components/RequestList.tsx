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
