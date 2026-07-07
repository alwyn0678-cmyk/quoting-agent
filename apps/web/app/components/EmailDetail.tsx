import Link from "next/link";
import type { RequestView } from "../../src/lib/dashboard";
import { eur, reasonLabel } from "../../src/lib/format";
import { StatusBadge } from "./StatusBadge";
import { SubmitButton } from "./SubmitButton";
import { archiveAction, requeueAction } from "../actions";

export function EmailDetail({ r }: { r: RequestView }) {
  const terminal = r.status === "escalated" || r.status === "error";

  return (
    <div className="detail">
      <div className="dhdr">
        From <b>{r.from_email ?? "(unknown sender)"}</b>
        {" · "}
        {new Date(r.created_at).toLocaleString("en-GB", { timeZone: "UTC" })} UTC{" "}
        <StatusBadge status={r.status} />
      </div>
      <h2 className="dsubj">{r.subject ?? "(no subject)"}</h2>
      <div className="emailbox card">{r.body ?? "(no message body)"}</div>

      {r.injection_flag ? (
        <div className="flagnote">
          ⚠ The sender&apos;s message contained text resembling an injection attempt — handled
          safely: pricing is computed by code, never by the model.
        </div>
      ) : null}

      {r.quote ? (
        <Link className="outcome" href={`/quotes?sel=${r.id}`}>
          <span>✅ Agent priced this — all-in {eur(r.quote.all_in_total)}</span>
          <span className="go">View quotation →</span>
        </Link>
      ) : r.status === "received" || r.status === "processing" ? (
        <div className="sentinfo sim">
          <span className="ic" aria-hidden>
            ⏳
          </span>
          <div>Processing — the agent hasn&apos;t finished this request yet.</div>
        </div>
      ) : (
        <div className="escalation">
          <strong>
            Escalated
            {r.escalation_reason ? ` — ${reasonLabel(r.escalation_reason)}` : ""}.
          </strong>{" "}
          Needs a human; no reply can be sent automatically.
        </div>
      )}

      {terminal ? (
        <div className="actions">
          <form action={requeueAction}>
            <input type="hidden" name="requestId" value={r.id} />
            <SubmitButton className="btn primary">↻ Re-run with agent</SubmitButton>
          </form>
          <form action={archiveAction}>
            <input type="hidden" name="requestId" value={r.id} />
            <SubmitButton className="btn ghost">Archive</SubmitButton>
          </form>
        </div>
      ) : null}

      {r.status === "sent" ? (
        <div className="actions">
          <form action={archiveAction}>
            <input type="hidden" name="requestId" value={r.id} />
            <SubmitButton className="btn ghost">Archive</SubmitButton>
          </form>
        </div>
      ) : null}
    </div>
  );
}
