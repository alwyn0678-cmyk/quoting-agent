import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { priceQuote, type PriceRequest, type RateEngine } from "./rate-engine.js";
import { assembleRateCard, type RateCardSource, type RateCardLineRow } from "./rate-card-source.js";
import type { RateQuote } from "./schemas.js";

/**
 * SupabaseTable adapter (1B.3): the shippable production rate engine. It reads the active rate card
 * for a {tenant, lane} from Supabase via a `RateCardSource`, assembles the StaticCard-shaped
 * `RateCard` (rate-card-source.ts), and delegates to the SAME pure `priceQuote()` — so its
 * `RateQuote` is identical to the StaticCard's by construction (AC-3); no pricing is reimplemented.
 */

export class SupabaseTableRateEngine implements RateEngine {
  constructor(
    private readonly source: RateCardSource,
    private readonly tenantId: string,
    private readonly lane: string,
  ) {}

  async price(req: PriceRequest): Promise<RateQuote> {
    const found = await this.source.fetchActiveCard(this.tenantId, this.lane);
    if (!found) {
      throw new Error(`no active rate card for tenant ${this.tenantId}, lane ${this.lane}`);
    }
    return priceQuote(req, assembleRateCard(found.card, found.lines));
  }
}

/** Real source backed by supabase-js. Server-side only (service_role bypasses RLS, scoped by tenant). */
export class SupabaseRateCardSource implements RateCardSource {
  constructor(private readonly client: SupabaseClient) {}

  async fetchActiveCard(tenantId: string, lane: string) {
    const { data: card, error: cardErr } = await this.client
      .from("rate_cards")
      .select("id, version, validity_through, lane")
      .eq("tenant_id", tenantId)
      .eq("lane", lane)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (cardErr) throw cardErr;
    if (!card) return null;

    const { data: lines, error: linesErr } = await this.client
      .from("rate_card_lines")
      .select("kind, code, container_type, amount, sort_order")
      .eq("rate_card_id", card.id);
    if (linesErr) throw linesErr;

    return {
      card: { version: card.version, validity_through: card.validity_through, lane: card.lane },
      lines: (lines ?? []) as RateCardLineRow[],
    };
  }
}

/** Build the production adapter from env (SUPABASE_URL + service_role key — server-side only). */
export function createSupabaseRateEngine(tenantId: string, lane: string): SupabaseTableRateEngine {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required for the Supabase rate engine");
  }
  return new SupabaseTableRateEngine(new SupabaseRateCardSource(createClient(url, key)), tenantId, lane);
}
