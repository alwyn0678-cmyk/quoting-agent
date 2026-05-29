import type { SupabaseClient } from "@supabase/supabase-js";
import type { RateQuote } from "../../../../packages/agents/src/schemas.js";

/**
 * Dashboard data access (1C.3). Reads the caller's quote_requests with their quote + draft. Tenant
 * scoping is enforced by Supabase RLS on the caller's JWT (browser anon + session), NOT by a filter
 * here — that is exactly what AC-5 proves. The rendered quote breakdown is read from the immutable
 * `breakdown_snapshot` (the priced RateQuote), so the view is consistent with AC-4 (never the live card).
 */

export interface RequestView {
  id: string;
  status: string;
  from_email: string | null;
  subject: string | null;
  created_at: string;
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
  draft: { subject: string; body: string } | null;
}

/** A joined row as returned by the embedded select below (PostgREST embeds 1:1 relations as arrays). */
export interface RawRequestRow {
  id: string;
  status: string;
  from_email: string | null;
  subject: string | null;
  created_at: string;
  quotes: { breakdown_snapshot: RateQuote }[] | { breakdown_snapshot: RateQuote } | null;
  drafts: { subject: string; body: string }[] | { subject: string; body: string } | null;
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
    created_at: row.created_at,
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
    draft: draft ? { subject: draft.subject, body: draft.body } : null,
  };
}

const SELECT =
  "id, status, from_email, subject, created_at, quotes(breakdown_snapshot), drafts(subject, body)";

/** List the caller's requests (RLS scopes to their tenant), newest first, as view models. */
export async function listRequestsForTenant(client: SupabaseClient): Promise<RequestView[]> {
  const { data, error } = await client
    .from("quote_requests")
    .select(SELECT)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as unknown as RawRequestRow[]).map(buildRequestView);
}
