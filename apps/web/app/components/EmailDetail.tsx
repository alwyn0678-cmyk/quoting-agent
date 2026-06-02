import Link from "next/link";
import type { RequestView } from "../../src/lib/dashboard";
import { StatusBadge } from "./StatusBadge";
import { archiveAction, requeueAction } from "../actions";

const REASON_LABELS: Record<string, string> = {
  missing_required_field: "Missing a required field",
  out_of_scope_lane: "Lane not in the rate card",
  out_of_scope_mode: "Transport mode not priced yet",
  out_of_scope_container: "Container type not priced on this lane",
  ambiguous_request: "Ambiguous request",
  low_confidence: "Low extraction confidence",
  guard_violation: "Safety guard tripped — failed closed",
};

const eur = (n: number) => `EUR ${n.toLocaleString("en-US")}`;

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
      ) : (
        <div className="escalation">
          <strong>
            Escalated
            {r.escalation_reason
              ? ` — ${REASON_LABELS[r.escalation_reason] ?? r.escalation_reason}`
              : ""}
            .
          </strong>{" "}
          Needs a human; no reply can be sent automatically.
        </div>
      )}

      {terminal ? (
        <div className="actions">
          <form action={requeueAction}>
            <input type="hidden" name="requestId" value={r.id} />
            <button type="submit" className="btn primary">
              ↻ Re-run with agent
            </button>
          </form>
          <form action={archiveAction}>
            <input type="hidden" name="requestId" value={r.id} />
            <button type="submit" className="btn ghost">
              Archive
            </button>
          </form>
        </div>
      ) : null}

      {r.status === "sent" ? (
        <div className="actions">
          <form action={archiveAction}>
            <input type="hidden" name="requestId" value={r.id} />
            <button type="submit" className="btn ghost">
              Archive
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
