import { type SupabaseClient } from "@supabase/supabase-js";
import type { RateQuote } from "./schemas.js";

/**
 * Quote persistence (1B.4). A quote row carries an immutable `breakdown_snapshot` (the full priced
 * RateQuote, frozen at pricing time) plus the `rate_card_version` it was priced on. Reads return the
 * snapshot, so editing or superseding a rate card later never changes an existing quote — historical
 * quotes stay reproducible (AC-4, D-16). 1:1 with the request (unique request_id), so a retry upserts.
 */

export interface QuoteRow {
  request_id: string;
  tenant_id: string;
  rate_card_version: string;
  container_type: string;
  container_qty: number;
  all_in_total: number;
  breakdown_snapshot: RateQuote;
  validity_through: string;
}

/** Pure mapping RateQuote -> quotes row. The snapshot is the whole quote (no live-card join on read). */
export function quoteToRow(requestId: string, tenantId: string, quote: RateQuote): QuoteRow {
  return {
    request_id: requestId,
    tenant_id: tenantId,
    rate_card_version: quote.rate_card_version,
    container_type: quote.container_type,
    container_qty: quote.container_qty,
    all_in_total: quote.all_in_total,
    breakdown_snapshot: quote,
    validity_through: quote.validity_through,
  };
}

export interface QuoteStore {
  /** Insert or update (by unique request_id) the quote for a request. Returns the row id. */
  upsertQuote(requestId: string, tenantId: string, quote: RateQuote): Promise<string>;
}

export class SupabaseQuoteStore implements QuoteStore {
  constructor(private readonly client: SupabaseClient) {}

  async upsertQuote(requestId: string, tenantId: string, quote: RateQuote): Promise<string> {
    const { data, error } = await this.client
      .from("quotes")
      .upsert(quoteToRow(requestId, tenantId, quote), { onConflict: "request_id" })
      .select("id")
      .single();
    if (error) throw error;
    return data.id as string;
  }
}
