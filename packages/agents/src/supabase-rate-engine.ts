import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { RateCard } from "./rate-card.js";
import { priceQuote, type PriceRequest, type RateEngine } from "./rate-engine.js";
import type { RateQuote } from "./schemas.js";

/**
 * SupabaseTable adapter (1B.3): the shippable production rate engine. It reads the active rate card
 * for a {tenant, lane} from Supabase, assembles the same in-memory `RateCard` shape the Phase 0
 * StaticCard uses, and delegates to the SAME pure `priceQuote()`. So its `RateQuote` is identical to
 * the StaticCard's by construction (AC-3) — no pricing logic is reimplemented here, only sourcing.
 */

/** Raw rows as stored by the 1B.1 schema. */
export interface RateCardRow {
  version: string;
  validity_through: string; // 'YYYY-MM-DD' from a Postgres date
  lane: string;
}
export interface RateCardLineRow {
  kind: "base" | "surcharge_per_container" | "per_shipment_fee";
  code: string;
  container_type: string | null;
  amount: number;
  sort_order: number;
}

/** Source of rate-card rows for a {tenant, lane}. Abstracted so the adapter is unit-testable without a DB. */
export interface RateCardSource {
  fetchActiveCard(
    tenantId: string,
    lane: string,
  ): Promise<{ card: RateCardRow; lines: RateCardLineRow[] } | null>;
}

/**
 * Assemble the in-memory `RateCard` from DB rows. surcharges / per_shipment_fees are ordered by
 * `sort_order` (within kind) so the produced arrays match the StaticCard exactly — the row order a
 * SELECT returns is otherwise unspecified.
 */
export function assembleRateCard(card: RateCardRow, lines: RateCardLineRow[]): RateCard {
  const base: Record<string, number> = {};
  for (const l of lines) {
    if (l.kind === "base" && l.container_type) base[l.container_type] = l.amount;
  }
  const ordered = (kind: RateCardLineRow["kind"]) =>
    lines.filter((l) => l.kind === kind).sort((a, b) => a.sort_order - b.sort_order);

  return {
    version: card.version,
    validity_through: card.validity_through,
    supported_lane: card.lane,
    base_per_container: base as RateCard["base_per_container"],
    surcharges: ordered("surcharge_per_container").map((l) => ({
      code: l.code,
      amount_per_container: l.amount,
    })),
    per_shipment_fees: ordered("per_shipment_fee").map((l) => ({ code: l.code, amount: l.amount })),
  };
}

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
