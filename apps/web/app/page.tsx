import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../lib/supabase/server";
import { listRequestsForTenant } from "../src/lib/dashboard";
import { AppShell } from "./components/AppShell";
import { RequestList, type RowItem } from "./components/RequestList";
import { EmailDetail } from "./components/EmailDetail";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ sel?: string }>;
}) {
  const { sel } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const requests = await listRequestsForTenant(supabase);
  const selected = requests.find((r) => r.id === sel) ?? null;
  const rows: RowItem[] = requests.map((r) => ({
    id: r.id,
    title: r.from_email ?? "(unknown sender)",
    subtitle: r.subject ?? "(no subject)",
    status: r.status,
  }));
  const awaiting = requests.filter((r) => r.status === "awaiting_review").length;

  return (
    <AppShell
      active="inbox"
      userEmail={user.email ?? ""}
      title="Inbox"
      subtitle={`${requests.length} request${requests.length === 1 ? "" : "s"} · ${awaiting} awaiting review`}
    >
      <RequestList rows={rows} selectedId={sel ?? null} hrefBase="/" />
      {selected ? (
        <EmailDetail r={selected} />
      ) : (
        <div className="detail empty">Select a request to view the email.</div>
      )}
    </AppShell>
  );
}
