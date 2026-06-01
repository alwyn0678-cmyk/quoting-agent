import type { RequestView } from "../../src/lib/dashboard";
import { StatusBadge } from "./StatusBadge";
import { unarchiveAction, requeueAction } from "../actions";

const eur = (n: number) => `EUR ${n.toLocaleString("en-US")}`;
const utc = (iso: string) => `${new Date(iso).toLocaleString("en-GB", { timeZone: "UTC" })} UTC`;

/** Archive detail: a read-only summary of an archived request + restore / re-run controls. */
export function ArchiveDetail({ r }: { r: RequestView }) {
  return (
    <div className="detail">
      <div className="dhdr">
        From <b>{r.from_email ?? "(unknown sender)"}</b>
        {" · "}
        <span className="chip arch">Archived{r.archived_at ? ` · ${utc(r.archived_at)}` : ""}</span>{" "}
        <StatusBadge status={r.status} />
      </div>
      <h2 className="dsubj">{r.subject ?? "(no subject)"}</h2>
      <div className="emailbox card">{r.body ?? "(no message body)"}</div>

      {r.quote ? (
        <div className="outcome" style={{ cursor: "default" }}>
          <span>✅ Quoted — all-in {eur(r.quote.all_in_total)}</span>
          <span className="go">{r.quote.lane}</span>
        </div>
      ) : (
        <div className="escalation">
          <strong>Escalated{r.escalation_reason ? ` — ${r.escalation_reason.replace(/_/g, " ")}` : ""}.</strong>{" "}
          Archived without a sent reply.
        </div>
      )}

      <div className="actions">
        <form action={unarchiveAction}>
          <input type="hidden" name="requestId" value={r.id} />
          <button type="submit" className="btn ghost">
            ↩ Restore
          </button>
        </form>
        {r.status === "escalated" || r.status === "error" ? (
          <form action={requeueAction}>
            <input type="hidden" name="requestId" value={r.id} />
            <button type="submit" className="btn primary">
              ↻ Re-run with agent
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
