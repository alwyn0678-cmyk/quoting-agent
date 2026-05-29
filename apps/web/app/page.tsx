import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../lib/supabase/server";
import { listRequestsForTenant, type RequestView } from "../src/lib/dashboard";
import { approveAction } from "./actions";

// Reads the signed-in user's cookies → always dynamic, never statically prerendered.
export const dynamic = "force-dynamic";

const eur = (n: number) => `EUR ${n.toLocaleString("en-US")}`;

function Breakdown({ quote }: { quote: NonNullable<RequestView["quote"]> }) {
  return (
    <div className="breakdown">
      <div className="lane">
        {quote.lane} · {quote.container_qty} × {quote.container_type} · card{" "}
        {quote.rate_card_version} · valid through {quote.validity_through}
      </div>
      <div className="line">
        <span className="code">Base (per container)</span>
        <span>{eur(quote.base_per_container)}</span>
      </div>
      {quote.surcharges.map((s) => (
        <div className="line" key={s.code}>
          <span className="code">{s.code} (per container)</span>
          <span>{eur(s.amount_per_container)}</span>
        </div>
      ))}
      {quote.per_shipment_fees.map((f) => (
        <div className="line" key={f.code}>
          <span className="code">{f.code} (per shipment)</span>
          <span>{eur(f.amount)}</span>
        </div>
      ))}
      <div className="line total">
        <span>All-in total</span>
        <span>{eur(quote.all_in_total)}</span>
      </div>
    </div>
  );
}

function RequestCard({ r }: { r: RequestView }) {
  return (
    <div className="card">
      <div className="head">
        <span className="from">{r.from_email ?? "(unknown sender)"}</span>
        <span className={`badge ${r.status}`}>
          {r.status === "sent" ? "SIMULATED SEND" : r.status.replace(/_/g, " ")}
        </span>
      </div>
      <div className="subject">{r.subject ?? "(no subject)"}</div>

      {r.quote ? (
        <Breakdown quote={r.quote} />
      ) : (
        <div className="breakdown lane">No quote — request was escalated for human review.</div>
      )}

      {r.draft && (
        <div className="draft">
          <div className="dsubject">{r.draft.subject}</div>
          <div className="dbody">{r.draft.body}</div>
        </div>
      )}

      {r.status === "awaiting_review" && r.quote && (
        <form action={approveAction} className="actions">
          <input type="hidden" name="requestId" value={r.id} />
          <button type="submit" className="primarybtn">
            Approve &amp; simulate send
          </button>
        </form>
      )}

      {r.status === "sent" && (
        <div className="sentinfo">
          ✓ Simulated send
          {r.draft?.simulated_sent_at
            ? ` · ${new Date(r.draft.simulated_sent_at).toLocaleString("en-GB", { timeZone: "UTC" })} UTC`
            : ""}
          <span className="nosend"> — no email was actually sent (Graph send is not wired; R1).</span>
        </div>
      )}
    </div>
  );
}

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS on the caller's JWT scopes this to their tenant — no manual tenant filter (AC-5).
  const requests = await listRequestsForTenant(supabase);

  return (
    <div className="wrap">
      <div className="topbar">
        <div>
          <h1>Quote requests</h1>
          <div className="sub">Linkport Forwarders — awaiting review</div>
        </div>
        <div className="who">
          <span>{user.email}</span>
          <form action="/auth/signout" method="post">
            <button className="linkbtn" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </div>

      {requests.length === 0 ? (
        <div className="empty">No requests in your tenant yet.</div>
      ) : (
        requests.map((r) => <RequestCard key={r.id} r={r} />)
      )}
    </div>
  );
}
