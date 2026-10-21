import { z } from "zod";

/**
 * Legacy (v1) rate-quote contract — whole-EUR quotes from the original demo/Excel/Supabase rate cards.
 * Kept because the legacy rate engine is the parity ORACLE for the canonical pricing core
 * (sources/legacy-card.test.ts) and the knowledge retriever builds its query from it. The agent's
 * extraction and output contracts now live in packages/core (request/schema.ts) and pipeline/output.ts.
 */

/** What the legacy rate engine can price. */
export const rateContainerTypeSchema = z.enum(["20GP", "40GP", "40HC", "45HC"]);

/** Whole EUR, non-negative (ASSUMPTIONS.md B3 — no cents, no FX on legacy cards). */
const eurAmount = z.number().int().nonnegative();

export const RateQuoteSchema = z.object({
  currency: z.literal("EUR"),
  lane: z.string().regex(/^[A-Z]{5}-[A-Z]{5}$/, "lane = ORIGIN-DEST UN/LOCODEs"),
  rate_card_version: z.string(),
  container_type: rateContainerTypeSchema,
  container_qty: z.number().int().positive(),
  base_per_container: eurAmount,
  surcharges: z.array(
    z.object({ code: z.string(), amount_per_container: eurAmount }),
  ),
  per_shipment_fees: z.array(z.object({ code: z.string(), amount: eurAmount })),
  all_in_total: eurAmount,
  validity_through: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date YYYY-MM-DD"),
});
export type RateQuote = z.infer<typeof RateQuoteSchema>;
