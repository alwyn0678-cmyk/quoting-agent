import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { priceQuote, UnpriceableRequestError, type PriceRequest, type RateEngine } from "./rate-engine.js";
import { assembleRateCard, type RateCardSource, type RateCardLineRow } from "./rate-card-source.js";
import type { RateCard } from "./rate-card.js";
import type { RateQuote } from "./schemas.js";

/**
 * SupabaseTable adapter (1B.3): the shippable production rate engine. It resolves the active rate card
 * for a {tenant, mode, lane} from Supabase via a `RateCardSource`, assembles the StaticCard-shaped
 * `RateCard` (rate-card-source.ts), and delegates to the SAME pure `priceQuote()` — so its
 * `RateQuote` is identical to the StaticCard's by construction (AC-3); no pricing is reimplemented.
 * The card is resolved from the REQUEST's mode+lane (not a fixed constructor lane), so one engine
 * serves every mode/lane the tenant has a card for.
 */
export class SupabaseTableRateEngine implements RateEngine {
  constructor(
    private readonly source: RateCardSource,
    private readonly tenantId: string,
  ) {}

  async cardFor(req: PriceRequest): Promise<RateCard | null> {
    const lane = `${req.origin_port_code ?? "?"}-${req.destination_port_code ?? "?"}`;
    const found = await this.source.fetchActiveCard(this.tenantId, req.mode, lane);
    return found ? assembleRateCard(found.card, found.lines) : null;
  }

  async price(req: PriceRequest): Promise<RateQuote> {
    const card = await this.cardFor(req);
    if (!card) {
      const lane = `${req.origin_port_code ?? "?"}-${req.destination_port_code ?? "?"}`;
      throw new UnpriceableRequestError("out_of_scope_lane", `no active card for mode ${req.mode}, lane ${lane}`);
    }
    return priceQuote(req, card);
  }
}

/** Real source backed by supabase-js. Server-side only (service_role bypasses RLS, scoped by tenant). */
export class SupabaseRateCardSource implements RateCardSource {
  constructor(private readonly client: SupabaseClient) {}

  async fetchActiveCard(tenantId: string, mode: string, lane: string) {
    const { data: card, error: cardErr } = await this.client
      .from("rate_cards")
      .select("id, mode, version, validity_through, lane")
      .eq("tenant_id", tenantId)
      .eq("mode", mode)
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
      card: { mode: card.mode, version: card.version, validity_through: card.validity_through, lane: card.lane },
      lines: (lines ?? []) as RateCardLineRow[],
    };
  }
}

/** Build the production adapter from env (SUPABASE_URL + service_role key — server-side only). */
export function createSupabaseRateEngine(tenantId: string): SupabaseTableRateEngine {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required for the Supabase rate engine");
  }
  return new SupabaseTableRateEngine(new SupabaseRateCardSource(createClient(url, key)), tenantId);
}
