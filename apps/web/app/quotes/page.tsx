import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { listRequestsForTenant, quotationsOnly } from "../../src/lib/dashboard";
import { AppShell } from "../components/AppShell";
import { RequestList, type RowItem } from "../components/RequestList";
import { QuoteDetail } from "../components/QuoteDetail";

export const dynamic = "force-dynamic";

const eur = (n: number) => `EUR ${n.toLocaleString("en-US")}`;

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ sel?: string | string[] }>;
}) {
  const params = await searchParams;
  const selectedId = Array.isArray(params.sel) ? params.sel[0] ?? null : params.sel ?? null;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const quotes = quotationsOnly(await listRequestsForTenant(supabase));
  const selected = quotes.find((r) => r.id === selectedId) ?? null;
  const rows: RowItem[] = quotes.map((r) => ({
    id: r.id,
    title: r.from_email ?? "(unknown sender)",
    subtitle: r.quote ? `${r.quote.lane} · ${r.quote.container_qty}×${r.quote.container_type}` : "",
    status: r.status,
    amount: r.quote ? eur(r.quote.all_in_total) : undefined,
    flag: r.injection_flag,
  }));
  const awaiting = quotes.filter((r) => r.status === "awaiting_review").length;

  return (
    <AppShell
      active="quotes"
      userEmail={user.email ?? ""}
      title="Quotations"
      subtitle={`${quotes.length} quote${quotes.length === 1 ? "" : "s"} · ${awaiting} awaiting review`}
    >
      <RequestList rows={rows} selectedId={selectedId} hrefBase="/quotes" />
      {selected ? (
        <QuoteDetail r={selected} />
      ) : (
        <div className="detail empty">Select a quotation to review.</div>
      )}
    </AppShell>
  );
}
