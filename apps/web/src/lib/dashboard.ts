/**
 * Dashboard data access (1C.3). Reads the caller's quote_requests with their quote + draft. Tenant
 * scoping is enforced by Supabase RLS on the caller's JWT (browser anon + session), NOT by a filter
 * here — that is exactly what AC-5 proves. The rendered quote breakdown is read from the immutable
 * `breakdown_snapshot` (the priced RateQuote), so the view is consistent with AC-4 (never the live card).
 */

/**
 * The fields the dashboard renders from a quote's immutable `breakdown_snapshot` (the priced RateQuote
 * frozen at pricing time). Declared LOCALLY so apps/web carries NO cross-package type dependency
 * (extends the D-19 decoupling) — which also lets the dashboard build standalone with Vercel's root
 * directory = apps/web. A full RateQuote satisfies this structurally; we only read these fields.
 */
interface QuoteSnapshot {
  lane: string;
  rate_card_version: string;
  container_type: string;
  container_qty: number;
  base_per_container: number;
  surcharges: { code: string; amount_per_container: number }[];
  per_shipment_fees: { code: string; amount: number }[];
  all_in_total: number;
  validity_through: string;
}

export interface RequestView {
  id: string;
  status: string;
  from_email: string | null;
  subject: string | null;
  body: string | null;
  created_at: string;
  escalation_reason: string | null;
  injection_flag: boolean;
  quote: {
    lane: string;
    container_type: string;
    container_qty: number;
    base_per_container: number;
    surcharges: { code: string; amount_per_container: number }[];
    per_shipment_fees: { code: string; amount: number }[];
    all_in_total: number;
    validity_through: string;
    rate_card_version: string;
  } | null;
  draft: { subject: string; body: string; simulated_sent_at: string | null } | null;
}

/** A joined row as returned by the embedded select below (PostgREST embeds 1:1 relations as arrays). */
export interface RawRequestRow {
  id: string;
  status: string;
  from_email: string | null;
  subject: string | null;
  body?: string | null;
  created_at: string;
  escalation_reason: string | null;
  injection_flag: boolean;
  quotes: { breakdown_snapshot: QuoteSnapshot }[] | { breakdown_snapshot: QuoteSnapshot } | null;
  drafts:
    | { subject: string; body: string; simulated_sent_at: string | null }[]
    | { subject: string; body: string; simulated_sent_at: string | null }
    | null;
}

function first<T>(x: T[] | T | null | undefined): T | null {
  if (Array.isArray(x)) return x[0] ?? null;
  return x ?? null;
}

/** Pure: map a joined row to the dashboard view model. The quote view is derived entirely from the
 *  breakdown_snapshot, so what the reviewer sees equals the frozen priced quote (P-1C.3 / AC-4). */
export function buildRequestView(row: RawRequestRow): RequestView {
  const snap = first(row.quotes)?.breakdown_snapshot ?? null;
  const draft = first(row.drafts);
  return {
    id: row.id,
    status: row.status,
    from_email: row.from_email,
    subject: row.subject,
    body: row.body ?? null,
    created_at: row.created_at,
    escalation_reason: row.escalation_reason,
    injection_flag: row.injection_flag,
    quote: snap
      ? {
          lane: snap.lane,
          container_type: snap.container_type,
          container_qty: snap.container_qty,
          base_per_container: snap.base_per_container,
          surcharges: snap.surcharges,
          per_shipment_fees: snap.per_shipment_fees,
          all_in_total: snap.all_in_total,
          validity_through: snap.validity_through,
          rate_card_version: snap.rate_card_version,
        }
      : null,
    draft: draft
      ? { subject: draft.subject, body: draft.body, simulated_sent_at: draft.simulated_sent_at ?? null }
      : null,
  };
}

const SELECT =
  "id, status, from_email, subject, body, created_at, escalation_reason, injection_flag, quotes(breakdown_snapshot), drafts(subject, body, simulated_sent_at)";

/**
 * The narrow slice of a Supabase client this lib actually uses: `from(table).select(cols).order(...)`
 * awaited to `{ data, error }`. Typed structurally (not as the concrete `SupabaseClient`) so the lib
 * carries NO supabase-js type dependency — it is immune to dependency duplication across the
 * folders-not-workspaces roots, and trivially fakeable in tests. Any real SupabaseClient satisfies it.
 */
type QueryResult = PromiseLike<{ data: unknown; error: unknown }>;
export interface RequestsReader {
  from(table: string): {
    select(columns: string): {
      order(column: string, options: { ascending: boolean }): QueryResult;
    };
  };
}

/** List the caller's requests (RLS scopes to their tenant), newest first, as view models. */
export async function listRequestsForTenant(client: RequestsReader): Promise<RequestView[]> {
  const { data, error } = await client
    .from("quote_requests")
    .select(SELECT)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as unknown as RawRequestRow[]).map(buildRequestView);
}

/** The requests that produced a quote — the Quotations tab list (escalations are Inbox-only). */
export function quotationsOnly(views: RequestView[]): RequestView[] {
  return views.filter((v) => v.quote !== null);
}
