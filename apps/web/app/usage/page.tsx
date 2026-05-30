import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { listUsageForTenant } from "../../src/lib/usage";
import { AppShell } from "../components/AppShell";

export const dynamic = "force-dynamic";

const usd = (n: number) => `$${n.toFixed(4)}`;
const fmt = (n: number) => n.toLocaleString("en-US");

export default async function UsagePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS scopes audit_log to the caller's tenant (AC-5 model) — no manual filter.
  const usage = await listUsageForTenant(supabase);

  return (
    <AppShell
      active="usage"
      userEmail={user.email ?? ""}
      title="Usage & cost"
      subtitle="Token + estimated cost per agent run (audit log)"
    >
      <div className="usagewrap">
        <div className="totals">
          <div className="stat">
            <div className="statn">{usage.totals.runs}</div>
            <div className="statl">runs</div>
          </div>
          <div className="stat">
            <div className="statn">{fmt(usage.totals.input_tokens)}</div>
            <div className="statl">input tokens</div>
          </div>
          <div className="stat">
            <div className="statn">{fmt(usage.totals.output_tokens)}</div>
            <div className="statl">output tokens</div>
          </div>
          <div className="stat">
            <div className="statn">{usd(usage.totals.est_cost_usd)}</div>
            <div className="statl">est. cost</div>
          </div>
        </div>

        {usage.rows.length === 0 ? (
          <div className="empty">No usage recorded yet.</div>
        ) : (
          <table className="usage">
            <thead>
              <tr>
                <th>When (UTC)</th>
                <th>Event</th>
                <th>Model(s)</th>
                <th className="num">In</th>
                <th className="num">Out</th>
                <th className="num">Est. cost</th>
              </tr>
            </thead>
            <tbody>
              {usage.rows.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.created_at).toLocaleString("en-GB", { timeZone: "UTC" })}</td>
                  <td>
                    <span className={`badge ${r.event}`}>{r.event}</span>
                  </td>
                  <td className="model">{r.model}</td>
                  <td className="num">{fmt(r.input_tokens)}</td>
                  <td className="num">{fmt(r.output_tokens)}</td>
                  <td className="num">{usd(r.est_cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="costnote">
          Estimated cost uses placeholder per-token prices (ASSUMPTIONS E3) — directional, not billing.
        </p>
      </div>
    </AppShell>
  );
}
