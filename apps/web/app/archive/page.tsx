import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { listRequestsForTenant, archivedOnly, navCounts } from "../../src/lib/dashboard";
import { eur } from "../../src/lib/format";
import { AppShell } from "../components/AppShell";
import { RequestList, type RowItem } from "../components/RequestList";
import { ArchiveDetail } from "../components/ArchiveDetail";

export const dynamic = "force-dynamic";

export default async function ArchivePage({
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

  const all = await listRequestsForTenant(supabase);
  const archived = archivedOnly(all);
  const selected = archived.find((r) => r.id === selectedId) ?? null;
  const rows: RowItem[] = archived.map((r) => ({
    id: r.id,
    title: r.from_email ?? "(unknown sender)",
    subtitle: r.quote
      ? `${r.quote.lane} · ${r.quote.container_qty}×${r.quote.container_type}`
      : r.subject ?? "(no subject)",
    status: r.status,
    amount: r.quote ? eur(r.quote.all_in_total) : undefined,
    flag: r.injection_flag,
    archived: true,
  }));

  return (
    <AppShell
      active="archive"
      userEmail={user.email ?? ""}
      title="Archive"
      subtitle={`${archived.length} archived request${archived.length === 1 ? "" : "s"}`}
      counts={navCounts(all)}
    >
      <RequestList rows={rows} selectedId={selectedId} hrefBase="/archive" />
      {selected ? (
        <ArchiveDetail r={selected} />
      ) : (
        <div className="detail empty">Select an archived request.</div>
      )}
    </AppShell>
  );
}
