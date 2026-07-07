import type { RequestView } from "../../src/lib/dashboard";
import { eur, utc } from "../../src/lib/format";
import { SubmitButton } from "./SubmitButton";
import { approveAction, archiveAction } from "../actions";

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
        <>
          <div className="sectlabel">Drafted reply</div>
          <div className="draft">
            <div className="ds">{r.draft.subject}</div>
            <div className="db">{r.draft.body}</div>
          </div>
        </>
      ) : null}

      {r.injection_flag ? (
        <div className="flagnote">
          ⚠ The sender&apos;s message contained text resembling an injection attempt. The price was
          computed by code (not the model) and the safety guard passed — review carefully before
          approving.
        </div>
      ) : null}

      {r.status === "awaiting_review" ? (
        <div className="actions">
          <form action={approveAction}>
            <input type="hidden" name="requestId" value={r.id} />
            <SubmitButton className="btn primary">✓ Approve &amp; send reply</SubmitButton>
          </form>
        </div>
      ) : null}

      {r.status === "sending" ? (
        <div className="sentinfo sim">
          <span className="ic" aria-hidden>
            ⏳
          </span>
          <div>
            Approved — reply <b>queued for send</b>
            {r.from_email ? ` to ${r.from_email}` : ""}. The send worker dispatches it via Microsoft
            Graph and marks it sent.
          </div>
        </div>
      ) : null}

      {r.status === "sent" ? (
        <>
          {r.draft?.sent_at ? (
            <div className="sentinfo real">
              <span className="ic" aria-hidden>
                📤
              </span>
              <div>
                Reply <b>sent</b> to <b>{r.from_email ?? "the requester"}</b>
                {` · ${utc(r.draft.sent_at)}`} — a real email was dispatched from the Linkport mailbox
                via Microsoft Graph.
              </div>
            </div>
          ) : (
            <div className="sentinfo sim">
              <span className="ic" aria-hidden>
                ✓
              </span>
              <div>
                Approved
                {r.draft?.simulated_sent_at ? ` · ${utc(r.draft.simulated_sent_at)}` : ""} — recorded
                as a <b>simulated</b> send (live Graph send is not configured for this dashboard, so no
                email was dispatched).
              </div>
            </div>
          )}
          <div className="actions">
            <form action={archiveAction}>
              <input type="hidden" name="requestId" value={r.id} />
              <SubmitButton className="btn ghost">Archive</SubmitButton>
            </form>
          </div>
        </>
      ) : null}
    </div>
  );
}
