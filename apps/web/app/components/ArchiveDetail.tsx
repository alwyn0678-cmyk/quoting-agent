import type { RequestView } from "../../src/lib/dashboard";
import { eur, utc, reasonLabel } from "../../src/lib/format";
import { StatusBadge } from "./StatusBadge";
import { SubmitButton } from "./SubmitButton";
import { unarchiveAction, requeueAction } from "../actions";

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
          <strong>Escalated{r.escalation_reason ? ` — ${reasonLabel(r.escalation_reason)}` : ""}.</strong>{" "}
          Archived without a sent reply.
        </div>
      )}

      <div className="actions">
        <form action={unarchiveAction}>
          <input type="hidden" name="requestId" value={r.id} />
          <SubmitButton className="btn ghost">↩ Restore</SubmitButton>
        </form>
        {r.status === "escalated" || r.status === "error" ? (
          <form action={requeueAction}>
            <input type="hidden" name="requestId" value={r.id} />
            <SubmitButton className="btn primary">↻ Re-run with agent</SubmitButton>
          </form>
        ) : null}
      </div>
    </div>
  );
}
