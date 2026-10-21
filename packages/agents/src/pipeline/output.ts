import { z } from "zod";
import { toMajorString, type Money } from "../../../core/src/money/money.js";
import { EQUIPMENT } from "../../../core/src/places/equipment.js";
import { portLabel } from "../../../core/src/places/ports.js";
import { chargeKey, phrase } from "../../../core/src/draft/phrasebook.js";
import { DraftChoiceSchema } from "../../../core/src/draft/render.js";
import { ESCALATION_REASONS, type EscalationReason } from "../../../core/src/reasons.js";
import { ShipmentRequestSchema, RequestFieldSchema } from "../../../core/src/request/schema.js";
import type { ChargeLine, PricingResult, RouteOption } from "../../../core/src/pricing/types.js";
import type { Wire } from "../../../core/src/pricing/wire.js";

/**
 * The agent's output contract (v2) and the two browser-safe projections derived from it by ALLOWLIST:
 *  - QuoteViewV2: presented options with sell amounts per line, totals, validity, transit, FX notes.
 *  - OutcomeDetailPublic: reason, missing fields, option counts.
 * Never in a projection: BUY costs, per-unit rates, margin rule ids, tariff ids/hashes/source refs,
 * unpresented candidates, the trace. The full pricing result goes only to service-role storage
 * (quote_internals). A test asserts no sensitive key appears in either projection.
 */

const MoneyWire = z.object({ minor: z.string().regex(/^\d+$/), currency: z.string().length(3) }).strict();
const moneyWire = (m: Money) => ({ minor: m.minor.toString(), currency: m.currency });

export const QuoteLineViewSchema = z
  .object({
    code: z.string(),
    label: z.string(),
    quantity: z.string(),
    sell: MoneyWire,
  })
  .strict();

export const QuoteOptionViewSchema = z
  .object({
    option_id: z.string(),
    carrier_label: z.string().nullable(),
    mode: z.string(),
    route: z.string(),
    transit_days: z.number().int().nullable(),
    valid_until: z.string(),
    lines: z.array(QuoteLineViewSchema),
    total: MoneyWire,
    fx_notes: z.array(z.object({ from: z.string(), to: z.string(), source: z.string(), as_of: z.string() }).strict()),
  })
  .strict();

export const QuoteViewV2Schema = z
  .object({
    quote_version: z.literal(2),
    quote_currency: z.string().length(3),
    options: z.array(QuoteOptionViewSchema).min(1),
  })
  .strict();
export type QuoteViewV2 = z.infer<typeof QuoteViewV2Schema>;

export const OutcomeDetailPublicSchema = z
  .object({
    reason: z.enum(ESCALATION_REASONS).nullable(),
    missing_fields: z.array(RequestFieldSchema),
    options_presented: z.number().int().nonnegative(),
    candidates: z.number().int().nonnegative(),
  })
  .strict();
export type OutcomeDetailPublic = z.infer<typeof OutcomeDetailPublicSchema>;

/** Keys that must never appear in a browser-visible projection (checked by test). */
export const SENSITIVE_KEYS = ["buy", "rate", "margin_rule_id", "tariff_id", "content_hash", "source_ref", "rate_line_id", "trace", "candidates_detail", "offer_key"];

function quantityText(l: ChargeLine): string {
  const q = l.qty.toString();
  switch (l.basis) {
    case "PER_CONTAINER":
      return l.equipment ? `${q} × ${EQUIPMENT[l.equipment].label}` : q;
    case "PER_TEU":
      return `${q} TEU`;
    case "PER_WM":
      return `${q} W/M`;
    case "PER_CBM":
      return `${q} m³`;
    case "PER_TON":
      return `${q} t`;
    case "PER_SHIPMENT":
      return "per shipment";
    case "PER_BL":
      return "per B/L";
    default:
      return "";
  }
}

function optionView(o: RouteOption, carrierLabels: Readonly<Record<string, string>>): z.infer<typeof QuoteOptionViewSchema> {
  const leg = o.legs[0]!;
  return {
    option_id: o.id,
    carrier_label: carrierLabels[o.carrier] ?? null,
    mode: leg.mode,
    route: `${portLabel(leg.origin)} → ${portLabel(leg.destination)}`,
    transit_days: o.transit_days,
    valid_until: o.valid_until,
    lines: [...o.legs.flatMap((l) => l.lines), ...o.adjustments].map((l) => ({
      code: l.code,
      label: phrase("en", chargeKey(l.code)),
      quantity: quantityText(l),
      sell: moneyWire(l.sell),
    })),
    total: moneyWire(o.totals.quote),
    fx_notes: o.fx_conversions
      .filter((r) => r.kind === "SELL")
      .map((r) => ({ from: r.from, to: r.to, source: r.source.toUpperCase().startsWith("ECB") ? "ECB reference rates" : "reference rates", as_of: r.as_of })),
  };
}

export function buildQuoteView(result: Extract<PricingResult, { kind: "priced" }>, carrierLabels: Readonly<Record<string, string>>): QuoteViewV2 {
  const presented = result.presented.map((id) => result.candidates.find((c) => c.id === id)!);
  return QuoteViewV2Schema.parse({
    quote_version: 2,
    quote_currency: result.quote_currency,
    options: presented.map((o) => optionView(o, carrierLabels)),
  });
}

/** A wire amount as a major-unit decimal string ("693000" EUR → "6930.00"), exactly. */
export function majorOf(m: z.infer<typeof MoneyWire>): string {
  return toMajorString({ minor: BigInt(m.minor), currency: m.currency as Money["currency"] });
}

/** The first (lowest) presented option's total, in major units. */
export function majorTotal(view: QuoteViewV2): string {
  return majorOf(view.options[0]!.total);
}

/** The quotes-table row (v2, migration 0021): summary columns + the sell-only view as the snapshot.
 *  Totals and validity summarise the FIRST presented option (lowest total); the view holds them all. */
export interface QuoteRowV2 {
  quote_version: 2;
  mode: string;
  currency: string;
  total_minor: string;
  option_count: number;
  breakdown_snapshot: QuoteViewV2;
  validity_through: string;
}

export function quoteRowV2(view: QuoteViewV2): QuoteRowV2 {
  const first = view.options[0]!;
  return {
    quote_version: 2,
    mode: first.mode,
    currency: view.quote_currency,
    total_minor: first.total.minor,
    option_count: view.options.length,
    breakdown_snapshot: view,
    validity_through: view.options.map((o) => o.valid_until).reduce((a, b) => (b < a ? b : a)),
  };
}

export const DraftOutSchema =z.object({ subject: z.string(), body: z.string() }).strict();

export const AgentOutputV2Schema = z
  .object({
    version: z.literal(2),
    decision: z.enum(["quote", "escalate"]),
    escalation_reason: z.enum(ESCALATION_REASONS).nullable(),
    missing_fields: z.array(RequestFieldSchema),
    detail: z.string(),
    /** null only when the email could not be extracted at all (e.g. request_too_large). */
    extraction: ShipmentRequestSchema.nullable(),
    injection_flag: z.boolean(),
    /** Full canonical pricing result (internal: costs, margins, candidates, trace). */
    pricing: z.custom<Wire>().nullable(),
    quote_view: QuoteViewV2Schema.nullable(),
    outcome: OutcomeDetailPublicSchema,
    draft: DraftOutSchema.nullable(),
    /** The model's closed style choices (language, formality, intro, closing); null if not reached. */
    draft_style: DraftChoiceSchema.nullable(),
    usage: z
      .object({
        model: z.string(),
        input_tokens: z.number().int().nonnegative(),
        output_tokens: z.number().int().nonnegative(),
        est_cost_usd: z.number().nonnegative().nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((o, ctx) => {
    const bad = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (o.decision === "quote" && (!o.quote_view || !o.draft || o.escalation_reason !== null)) bad("a quote needs quote_view + draft and no reason");
    if (o.decision === "escalate" && (o.quote_view !== null || o.draft !== null || o.escalation_reason === null)) bad("an escalation has a reason and no quote_view/draft");
  });
export type AgentOutputV2 = z.infer<typeof AgentOutputV2Schema>;
export type { EscalationReason };
