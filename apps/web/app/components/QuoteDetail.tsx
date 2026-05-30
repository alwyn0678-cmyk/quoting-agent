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

      {r.injection_flag ? (
        <div className="flagnote">
          ⚠ The sender&apos;s message contained text resembling an injection attempt. The price was
          computed by code (not the model) and the safety guard passed — review carefully before
          approving.
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
