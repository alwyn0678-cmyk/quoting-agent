/**
 * Usage / cost observability (1C.6). Reads the caller's audit_log usage rows (RLS-scoped to their
 * tenant) and builds a view: per-run model + tokens + estimated cost, plus tenant totals. This is
 * the observability evidence for the learning goal (P-1C.6 / T13 parity) and the cost signal behind
 * the K2 kill switch. Same structural-client discipline as dashboard.ts — no supabase-js type dep,
 * immune to dependency duplication, trivially fakeable.
 */

type QueryResult = PromiseLike<{ data: unknown; error: unknown }>;
interface AuditReader {
  from(table: string): {
    select(columns: string): {
      order(column: string, options: { ascending: boolean }): QueryResult;
    };
  };
}

export interface UsageRow {
  id: string;
  request_id: string | null;
  event: string;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  est_cost_usd: number;
  created_at: string;
}

export interface UsageView {
  rows: UsageRow[];
  totals: { runs: number; input_tokens: number; output_tokens: number; est_cost_usd: number };
}

/** A raw audit_log row as selected below. Token/cost columns are nullable in the DB; numeric may
 *  arrive as a string from PostgREST, so it is coerced. */
export interface RawUsageRow {
  id: string;
  request_id: string | null;
  event: string;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  est_cost_usd: number | string | null;
  created_at: string;
}

const num = (x: number | string | null | undefined): number => {
  const n = typeof x === "string" ? Number(x) : (x ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Pure: normalize raw audit rows (nullable/string numerics) to a usage view + tenant totals. Only
 *  usage-bearing rows (a model was recorded) are surfaced — that is the per-invocation token log. */
export function buildUsageView(rows: RawUsageRow[]): UsageView {
  const usageRows: UsageRow[] = rows
    .filter((r) => r.model !== null)
    .map((r) => ({
      id: r.id,
      request_id: r.request_id,
      event: r.event,
      model: r.model,
      input_tokens: num(r.input_tokens),
      output_tokens: num(r.output_tokens),
      est_cost_usd: num(r.est_cost_usd),
      created_at: r.created_at,
    }));
  const totals = usageRows.reduce(
    (a, r) => ({
      runs: a.runs + 1,
      input_tokens: a.input_tokens + r.input_tokens,
      output_tokens: a.output_tokens + r.output_tokens,
      est_cost_usd: a.est_cost_usd + r.est_cost_usd,
    }),
    { runs: 0, input_tokens: 0, output_tokens: 0, est_cost_usd: 0 },
  );
  return { rows: usageRows, totals };
}

const USAGE_SELECT = "id, request_id, event, model, input_tokens, output_tokens, est_cost_usd, created_at";

/** List the caller's usage rows (RLS scopes to their tenant), newest first, as a usage view. */
export async function listUsageForTenant(client: AuditReader): Promise<UsageView> {
  const { data, error } = await client
    .from("audit_log")
    .select(USAGE_SELECT)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return buildUsageView(data as unknown as RawUsageRow[]);
}
