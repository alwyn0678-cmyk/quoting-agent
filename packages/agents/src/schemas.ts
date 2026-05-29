import { z } from "zod";

/**
 * Data contracts for the Phase 0 slice (see docs/SLICE.md). These Zod schemas are the
 * single source of truth: they validate LLM structured output AND back the acceptance
 * tests. Monetary values are whole EUR by deliberate choice (ASSUMPTIONS.md B3).
 */

/** UN/LOCODE: 2-letter country + 3-char location (letters or digits 2-9). */
const portCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}[A-Z0-9]{3}$/, "expected a 5-char UN/LOCODE");

const locationSchema = z.object({
  raw: z.string(),
  port_code: portCodeSchema.nullable(),
});

export const modeSchema = z.enum(["FCL", "LCL", "AIR", "RAIL", "UNKNOWN"]);

/** What the extractor may report — includes UNKNOWN / absent. */
export const extractionContainerTypeSchema = z
  .enum(["20GP", "40GP", "40HC", "UNKNOWN"])
  .nullable();

/** What the rate engine can actually price — the real supported set only. */
export const rateContainerTypeSchema = z.enum(["20GP", "40GP", "40HC"]);

const confidence = z.number().min(0).max(1);

export const ExtractionResultSchema = z.object({
  origin: locationSchema,
  destination: locationSchema,
  mode: modeSchema,
  container_type: extractionContainerTypeSchema,
  container_qty: z.number().int().positive().nullable(),
  incoterm: z.string().nullable(),
  commodity: z.string().nullable(),
  ready_date: z.string().nullable(),
  weight_kg: z.number().positive().nullable(),
  requester_name: z.string().nullable(),
  requester_company: z.string().nullable(),
  /** 0..1 confidence per required field. Open record — keys are field names. */
  field_confidence: z.record(z.string(), confidence),
  overall_confidence: confidence,
  /** The model's own injection flag; corroborated by a code-side guard (Task 6). */
  injection_detected: z.boolean(),
});
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

/** Whole EUR, non-negative (ASSUMPTIONS.md B3 — no cents, no FX in Phase 0). */
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

export const decisionSchema = z.enum(["quote", "escalate"]);

export const escalationReasonSchema = z.enum([
  "missing_required_field",
  "out_of_scope_lane",
  "out_of_scope_mode",
  "ambiguous_request",
  "low_confidence",
  "guard_violation",
]);
export type EscalationReason = z.infer<typeof escalationReasonSchema>;

export const DraftSchema = z.object({ subject: z.string(), body: z.string() });
export type Draft = z.infer<typeof DraftSchema>;

const usageSchema = z.object({
  model: z.string(),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  est_cost_usd: z.number().nonnegative(),
});

/**
 * The agent's output for one email. The superRefine encodes the load-bearing invariant
 * the escalation gate depends on: a "quote" carries a quote + draft and no reason;
 * an "escalate" carries a reason and neither quote nor draft.
 */
export const AgentOutputSchema = z
  .object({
    decision: decisionSchema,
    extraction: ExtractionResultSchema,
    injection_flag: z.boolean(),
    escalation_reason: escalationReasonSchema.nullable(),
    quote: RateQuoteSchema.nullable(),
    draft: DraftSchema.nullable(),
    usage: usageSchema,
  })
  .superRefine((o, ctx) => {
    const bad = (message: string, path: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [path] });
    if (o.decision === "quote") {
      if (o.quote === null) bad("decision 'quote' requires a quote", "quote");
      if (o.draft === null) bad("decision 'quote' requires a draft", "draft");
      if (o.escalation_reason !== null)
        bad("decision 'quote' must not carry an escalation_reason", "escalation_reason");
    } else {
      if (o.quote !== null) bad("decision 'escalate' must not carry a quote", "quote");
      if (o.draft !== null) bad("decision 'escalate' must not carry a draft", "draft");
      if (o.escalation_reason === null)
        bad("decision 'escalate' requires an escalation_reason", "escalation_reason");
    }
  });
export type AgentOutput = z.infer<typeof AgentOutputSchema>;
