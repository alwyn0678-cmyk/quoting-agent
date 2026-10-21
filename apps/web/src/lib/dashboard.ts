/**
 * Dashboard data access (1C.3). Reads the caller's quote_requests with their quote + draft. Tenant
 * scoping is enforced by Supabase RLS on the caller's JWT (browser anon + session), NOT by a filter
 * here — that is exactly what AC-5 proves. The rendered quote breakdown is read from the immutable
 * `breakdown_snapshot`, so the view is consistent with AC-4 (never the live card). Two snapshot shapes
 * coexist in `quotes` (migration 0021): v1 = the legacy RateQuote, v2 = the sell-only QuoteViewV2.
 * `quote_internals` (costs, margins) is service_role-only and is never read here.
 */

import { eur, minorMoney } from "./format";

/**
 * The fields the dashboard renders from a v1 quote's immutable `breakdown_snapshot` (the priced
 * RateQuote frozen at pricing time). Declared LOCALLY so apps/web carries NO cross-package type
 * dependency (extends the D-19 decoupling) — which also lets the dashboard build standalone with
 * Vercel's root directory = apps/web. A full RateQuote satisfies this structurally.
 */
interface QuoteSnapshotV1 {
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

/** Summary every quote view carries, whatever its version — what lists and outcome links render. */
interface QuoteSummaryBase {
  /** One-line description, e.g. "NLRTM-USNYC · 2×40HC" (v1) or "<route> · FCL · 2 options" (v2). */
  headline: string;
  /** Display total with currency, exact from minor units (v2: the first/lowest option); null if unreadable. */
  total: string | null;
  /** Validity of the summarised (first, lowest-total) option; null if unreadable. */
  validity: string | null;
  option_count: number;
}

export type QuoteV1View = QuoteSummaryBase & { version: 1 } & QuoteSnapshotV1;

/** One presented v2 option, amounts pre-formatted for display (sell only — no costs exist here). */
export interface QuoteOptionView {
  option_id: string;
  carrier_label: string | null;
  mode: string;
  route: string;
  transit_days: number | null;
  valid_until: string;
  /** Per-line amounts; empty for a cost-based option shown as total-only (no buy prices revealed). */
  lines: { code: string; label: string; quantity: string; sell: string }[];
  /** Names of the charges an option includes (always present; the only detail when not itemised). */
  included: string[];
  total: string;
  fx_notes: { from: string; to: string; source: string; as_of: string }[];
}
export type QuoteV2View = QuoteSummaryBase & { version: 2; currency: string; options: QuoteOptionView[]; assumptions: string[] };

/** A quote row exists but its snapshot matches neither shape — render a safe notice, never crash. */
export type QuoteUnreadableView = QuoteSummaryBase & { version: "unreadable" };

export type QuoteView = QuoteV1View | QuoteV2View | QuoteUnreadableView;

export interface RequestView {
  id: string;
  status: string;
  from_email: string | null;
  subject: string | null;
  body: string | null;
  created_at: string;
  archived_at: string | null;
  escalation_reason: string | null;
  /** outcome_detail.missing_fields (v2 runs); [] for older rows or when absent. */
  missing_fields: string[];
  injection_flag: boolean;
  quote: QuoteView | null;
  // sent_at = a REAL Graph send happened (D-27); simulated_sent_at = the legacy simulated stamp.
  draft: { subject: string; body: string; simulated_sent_at: string | null; sent_at: string | null } | null;
}

/** A joined row as returned by the embedded select below (PostgREST embeds 1:1 relations as arrays). */
type RawDraft = { subject: string; body: string; simulated_sent_at: string | null; sent_at?: string | null };
export interface RawRequestRow {
  id: string;
  status: string;
  from_email: string | null;
  subject: string | null;
  body?: string | null;
  created_at: string;
  archived_at?: string | null;
  escalation_reason: string | null;
  outcome_detail?: unknown;
  injection_flag: boolean;
  quotes: RawQuote[] | RawQuote | null;
  drafts: RawDraft[] | RawDraft | null;
}

/** quote_version is absent on pre-0021 fixtures/rows; the snapshot is untrusted jsonb until parsed. */
type RawQuote = { quote_version?: number | null; breakdown_snapshot: unknown };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === "string";
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

function parseV1(x: unknown): QuoteV1View | null {
  if (!isObj(x)) return null;
  const { lane, rate_card_version, container_type, container_qty, base_per_container, surcharges, per_shipment_fees, all_in_total, validity_through } = x;
  if (!isStr(lane) || !isStr(rate_card_version) || !isStr(container_type) || !isStr(validity_through)) return null;
  if (!isNum(container_qty) || !isNum(base_per_container) || !isNum(all_in_total)) return null;
  if (!Array.isArray(surcharges) || !surcharges.every((c) => isObj(c) && isStr(c.code) && isNum(c.amount_per_container))) return null;
  if (!Array.isArray(per_shipment_fees) || !per_shipment_fees.every((f) => isObj(f) && isStr(f.code) && isNum(f.amount))) return null;
  return {
    version: 1,
    headline: `${lane} · ${container_qty}×${container_type}`,
    total: eur(all_in_total),
    validity: validity_through,
    option_count: 1,
    lane,
    container_type,
    container_qty,
    base_per_container,
    surcharges: surcharges as QuoteSnapshotV1["surcharges"],
    per_shipment_fees: per_shipment_fees as QuoteSnapshotV1["per_shipment_fees"],
    all_in_total,
    validity_through,
    rate_card_version,
  };
}

/** A wire amount { minor, currency } formatted exactly, or null if malformed. */
function wireMoney(m: unknown): string | null {
  return isObj(m) && isStr(m.minor) && isStr(m.currency) ? minorMoney(m.minor, m.currency) : null;
}

function parseOptionV2(o: unknown): QuoteOptionView | null {
  if (!isObj(o)) return null;
  const { option_id, carrier_label, mode, route, transit_days, valid_until, lines, fx_notes } = o;
  const included = o.included ?? [];
  if (!Array.isArray(included) || !included.every(isStr)) return null;
  if (!isStr(option_id) || !isStr(mode) || !isStr(route) || !isStr(valid_until)) return null;
  if (carrier_label !== null && !isStr(carrier_label)) return null;
  if (transit_days !== null && !isNum(transit_days)) return null;
  const total = wireMoney(o.total);
  if (total === null || !Array.isArray(lines) || !Array.isArray(fx_notes)) return null;
  const lineViews: QuoteOptionView["lines"] = [];
  for (const l of lines) {
    const sell = isObj(l) ? wireMoney(l.sell) : null;
    if (!isObj(l) || sell === null || !isStr(l.code) || !isStr(l.label) || !isStr(l.quantity)) return null;
    lineViews.push({ code: l.code, label: l.label, quantity: l.quantity, sell });
  }
  if (!fx_notes.every((n) => isObj(n) && isStr(n.from) && isStr(n.to) && isStr(n.source) && isStr(n.as_of))) return null;
  return {
    option_id,
    carrier_label,
    mode,
    route,
    transit_days,
    valid_until,
    lines: lineViews,
    included: included as string[],
    total,
    fx_notes: (fx_notes as QuoteOptionView["fx_notes"]).map(({ from, to, source, as_of }) => ({ from, to, source, as_of })),
  };
}

/** Structural mirror of QuoteViewV2Schema (packages/agents pipeline/output.ts) — hand-checked because
 *  apps/web builds standalone without zod or cross-package runtime imports. */
function parseV2(x: unknown): QuoteV2View | null {
  if (!isObj(x) || x.quote_version !== 2 || !isStr(x.quote_currency)) return null;
  if (!Array.isArray(x.options) || x.options.length === 0) return null;
  const assumptions = x.assumptions ?? [];
  if (!Array.isArray(assumptions) || !assumptions.every(isStr)) return null;
  const options: QuoteOptionView[] = [];
  for (const raw of x.options) {
    const o = parseOptionV2(raw);
    if (!o) return null;
    options.push(o);
  }
  const first = options[0]!;
  const n = options.length;
  return {
    version: 2,
    headline: `${first.route} · ${first.mode}${n > 1 ? ` · ${n} options` : ""}`,
    total: first.total,
    validity: first.valid_until,
    option_count: n,
    currency: x.quote_currency,
    options,
    assumptions: assumptions as string[],
  };
}

const UNREADABLE: QuoteUnreadableView = {
  version: "unreadable",
  headline: "Quote breakdown unavailable",
  total: null,
  validity: null,
  option_count: 0,
};

/** Discriminate on the row's quote_version (falling back to the snapshot's own marker for pre-0021
 *  rows); a snapshot that fails its version's shape check becomes the unreadable fallback. */
export function buildQuoteView(q: RawQuote): QuoteView {
  const snap = q.breakdown_snapshot;
  const version = q.quote_version ?? (isObj(snap) && snap.quote_version === 2 ? 2 : 1);
  return (version === 2 ? parseV2(snap) : version === 1 ? parseV1(snap) : null) ?? UNREADABLE;
}

function missingFields(detail: unknown): string[] {
  return isObj(detail) && Array.isArray(detail.missing_fields) ? detail.missing_fields.filter(isStr) : [];
}

function first<T>(x: T[] | T | null | undefined): T | null {
  if (Array.isArray(x)) return x[0] ?? null;
  return x ?? null;
}

/** Pure: map a joined row to the dashboard view model. The quote view is derived entirely from the
 *  breakdown_snapshot, so what the reviewer sees equals the frozen priced quote (P-1C.3 / AC-4). */
export function buildRequestView(row: RawRequestRow): RequestView {
  const quote = first(row.quotes);
  const draft = first(row.drafts);
  return {
    id: row.id,
    status: row.status,
    from_email: row.from_email,
    subject: row.subject,
    body: row.body ?? null,
    created_at: row.created_at,
    archived_at: row.archived_at ?? null,
    escalation_reason: row.escalation_reason,
    missing_fields: missingFields(row.outcome_detail),
    injection_flag: row.injection_flag,
    quote: quote ? buildQuoteView(quote) : null,
    draft: draft
      ? {
          subject: draft.subject,
          body: draft.body,
          simulated_sent_at: draft.simulated_sent_at ?? null,
          sent_at: draft.sent_at ?? null,
        }
      : null,
  };
}

const SELECT =
  "id, status, from_email, subject, body, created_at, archived_at, escalation_reason, outcome_detail, injection_flag, quotes(quote_version, breakdown_snapshot), drafts(subject, body, simulated_sent_at, sent_at)";

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

/** Active = not soft-archived. The Inbox/Quotations tabs show only active requests. */
export function activeOnly(views: RequestView[]): RequestView[] {
  return views.filter((v) => v.archived_at === null);
}

/** Archived = soft-archived — the Archive tab. */
export function archivedOnly(views: RequestView[]): RequestView[] {
  return views.filter((v) => v.archived_at !== null);
}

export interface NavCounts {
  inbox: number;
  quotes: number;
  archive: number;
}

/** Sidebar pip counts: open (non-sent) active requests, quotes awaiting approval, archived total. */
export function navCounts(all: RequestView[]): NavCounts {
  const active = activeOnly(all);
  return {
    inbox: active.filter((v) => v.status !== "sent").length,
    quotes: quotationsOnly(active).filter((v) => v.status === "awaiting_review").length,
    archive: archivedOnly(all).length,
  };
}
