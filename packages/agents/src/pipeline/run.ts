import { gateRequest } from "../../../core/src/gate/gate.js";
import { price } from "../../../core/src/pricing/engine.js";
import { toWire } from "../../../core/src/pricing/wire.js";
import { guardPricing, containsCanary } from "../../../core/src/guard/guard.js";
import { renderQuoteEmail, draftLocale, formatMoney, type DraftChoice } from "../../../core/src/draft/render.js";
import type { EscalationReason } from "../../../core/src/reasons.js";
import type { RequestField, ShipmentRequest } from "../../../core/src/request/schema.js";
import type { PricingResult } from "../../../core/src/pricing/types.js";
import { SYSTEM_CANARY, PER_STEP_ROUTING, type ModelRouting } from "../config.js";
import { estimateStepCostUsd, sumCosts } from "../llm/pricing.js";
import { LlmOutputError, LlmRefusalError, type LlmClient, type Usage } from "../llm.js";
import { TariffConfigError, type TariffSource } from "../sources/tariff-source.js";
import { extractShipmentRequest, RequestTooLargeError, type EmailInput } from "./extract.js";
import { chooseDraftStyle } from "./draft-choice.js";
import { AgentOutputV2Schema, buildQuoteView, type AgentOutputV2, type QuoteViewV2 } from "./output.js";
import type { TenantConfig } from "./tenant.js";
import { PROMPT_VERSION } from "./observability.js";

/** Overall-confidence floor below which a priceable request goes to a human. ASSUMPTIONS.md E1. */
export const CONFIDENCE_THRESHOLD = 0.75;
/** Per-field floor for the fields that drive THIS request's price (ASSUMPTIONS.md E4). */
export const FIELD_CONFIDENCE_FLOOR = 0.5;

/** The fields whose misreading would change the price of a request in this mode. */
function priceRelevantFields(mode: string): RequestField[] {
  const base: RequestField[] = ["origin", "destination", "mode", "service"];
  return mode === "LCL" ? [...base, "weight", "volume"] : [...base, "containers"];
}

export interface AgentDeps {
  llm: LlmClient;
  tariffs: TariffSource;
  tenant: TenantConfig;
  routing?: ModelRouting;
}

export interface RunOptions {
  /** The date validity is checked against (YYYY-MM-DD). Defaults to today (UTC). */
  asOf?: string;
}

/** Today's date as YYYY-MM-DD in UTC (ASSUMPTIONS.md A10). */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

interface Step {
  model: string;
  usage: Usage;
  label: "extract" | "draft";
}

/**
 * The v2 pipeline for ONE email — pure orchestration over ports (LLM, tariff source, tenant config):
 *
 *   extract (LLM) → gate (code) → tariff snapshot (port) → price (code) → confidence floor →
 *   guard: re-derive pricing (code) → style choice (LLM, closed enums) → render draft (code) →
 *   canary scan of the whole output (code).
 *
 * Every non-quote path is a named escalation from the core taxonomy. Model refusals and schema-invalid
 * model output escalate; infrastructure faults (network, database) propagate so the durable job
 * retries. The pricing result is kept on escalations past pricing so a reviewer sees what was computed.
 */
export async function runAgentV2(email: EmailInput, deps: AgentDeps, options: RunOptions = {}): Promise<AgentOutputV2> {
  const asOf = options.asOf ?? todayIso();
  const routing = deps.routing ?? PER_STEP_ROUTING;
  const steps: Step[] = [];

  let request: ShipmentRequest | null = null;
  let pricing: PricingResult | null = null;
  let quoteView: QuoteViewV2 | null = null;
  let draft: { subject: string; body: string } | null = null;
  let style: DraftChoice | null = null;
  let reason: EscalationReason | null = null;
  let missing: RequestField[] = [];
  let detail = "";

  const escalate = (r: EscalationReason, d: string, fields: RequestField[] = []) => {
    reason = r;
    detail = d;
    missing = fields;
  };

  outcome: {
    // 1. Extraction.
    try {
      const x = await extractShipmentRequest(email, deps.llm, routing.extraction);
      steps.push({ model: x.model, usage: x.usage, label: "extract" });
      request = x.request;
    } catch (err) {
      if (err instanceof RequestTooLargeError) escalate("request_too_large", err.message);
      else if (err instanceof LlmRefusalError) escalate("model_refused", "extraction refused by the model");
      else if (err instanceof LlmOutputError) escalate("model_output_invalid", err.message);
      else throw err;
      break outcome;
    }

    // 2. Gate (identity → mode → service → special cargo → completeness → conflicts).
    const gate = gateRequest(request);
    if (!gate.pass) {
      escalate(gate.reason, gate.detail, gate.missing_fields);
      break outcome;
    }

    // 3. One validated, hashed tariff snapshot for this lane; pricing and the guard both use it.
    let tariffs;
    try {
      tariffs = await deps.tariffs.snapshot(deps.tenant.id, { mode: gate.input.mode, origin: gate.input.origin, destination: gate.input.destination });
    } catch (err) {
      if (err instanceof TariffConfigError) {
        escalate("tariff_config_error", err.message);
        break outcome;
      }
      throw err;
    }

    // 4. Price.
    const ctx = deps.tenant.pricing(asOf);
    pricing = price(gate.input, tariffs, ctx);
    if (pricing.kind === "unpriceable") {
      escalate(pricing.reason, pricing.detail);
      break outcome;
    }

    // 5. Confidence floor — after pricing so the reviewer still sees the computed options.
    if (request.overall_confidence < CONFIDENCE_THRESHOLD) {
      escalate("low_confidence", `overall confidence ${request.overall_confidence} < ${CONFIDENCE_THRESHOLD}`);
      break outcome;
    }
    const relevant = priceRelevantFields(request.mode);
    const unsure = request.field_confidence.filter((f) => relevant.includes(f.field) && f.confidence < FIELD_CONFIDENCE_FLOOR).map((f) => f.field);
    if (unsure.length > 0) {
      escalate("low_confidence", `unsure about ${unsure.join(", ")} (< ${FIELD_CONFIDENCE_FLOOR})`, unsure);
      break outcome;
    }

    // 6. Guard: an independent re-derivation must be byte-identical.
    const violations = guardPricing(gate.input, tariffs, ctx, pricing);
    if (violations.length > 0) {
      escalate("guard_violation", `pricing guard: ${violations.join(", ")}`);
      break outcome;
    }

    // 7. Style choice (closed enums) → the whole email rendered by code.
    let choice;
    try {
      const c = await chooseDraftStyle(email, deps.llm, routing.draft);
      steps.push({ model: c.model, usage: c.usage, label: "draft" });
      choice = c.choice;
      style = c.choice;
    } catch (err) {
      if (err instanceof LlmRefusalError) escalate("model_refused", "draft style refused by the model");
      else if (err instanceof LlmOutputError) escalate("model_output_invalid", err.message);
      else throw err;
      break outcome;
    }
    try {
      draft = renderQuoteEmail({ choice, tenant: deps.tenant.presentation, request, result: pricing });
      quoteView = buildQuoteView(pricing, deps.tenant.presentation, request);
      // The customer text must state every presented total exactly as the engine computed it.
      const locale = draftLocale(deps.tenant.presentation.locale, choice.language);
      for (const id of pricing.presented) {
        const o = pricing.candidates.find((c) => c.id === id)!;
        if (!draft.body.includes(formatMoney(o.totals.quote, locale))) throw new Error(`draft does not state option total ${o.id}`);
      }
    } catch (err) {
      // The renderer fails closed on malformed presentation data — deterministic, so never retried.
      escalate("guard_violation", `render failed: ${(err as Error).message}`);
      break outcome;
    }
  }

  const finalRequest = request as ShipmentRequest | null;
  const finalPricing = pricing as PricingResult | null;
  const candidate: AgentOutputV2 = {
    version: 2,
    decision: reason === null ? "quote" : "escalate",
    escalation_reason: reason,
    missing_fields: missing,
    detail,
    extraction: finalRequest,
    injection_flag: finalRequest?.injection_detected ?? false,
    pricing: finalPricing ? toWire(finalPricing) : null,
    quote_view: reason === null ? quoteView : null,
    outcome: {
      reason,
      missing_fields: missing,
      options_presented: reason === null && finalPricing?.kind === "priced" ? finalPricing.presented.length : 0,
      candidates: finalPricing?.kind === "priced" ? finalPricing.candidates.length : 0,
    },
    draft: reason === null ? draft : null,
    draft_style: style,
    prompt_version: PROMPT_VERSION,
    usage: usageOf(steps),
  };

  // 8. Final safety net on EVERY path: the system canary must never appear anywhere in the output —
  // unless the sender wrote it into the email themselves (an echo of untrusted input, not a prompt leak).
  const echoed = [email.from, email.subject, email.body].some((t) => t.includes(SYSTEM_CANARY));
  if (!echoed && containsCanary(candidate, SYSTEM_CANARY)) {
    const redacted = JSON.parse(JSON.stringify(toWire(candidate)).split(SYSTEM_CANARY).join("[REDACTED]"));
    return AgentOutputV2Schema.parse({
      ...candidate,
      extraction: redacted.extraction,
      detail: "system canary found in output",
      decision: "escalate",
      escalation_reason: "guard_violation",
      missing_fields: [],
      quote_view: null,
      draft: null,
      outcome: { ...candidate.outcome, reason: "guard_violation", missing_fields: [], options_presented: 0 },
    });
  }
  return AgentOutputV2Schema.parse(candidate);
}

function usageOf(steps: Step[]): AgentOutputV2["usage"] {
  return {
    // Honest: the model(s) that actually served each step that ran.
    model: steps.length === 0 ? "none" : steps.map((s) => `${s.model} (${s.label})`).join(", "),
    input_tokens: steps.reduce((n, s) => n + s.usage.input_tokens, 0),
    output_tokens: steps.reduce((n, s) => n + s.usage.output_tokens, 0),
    est_cost_usd: steps.length === 0 ? 0 : sumCosts(steps.map((s) => estimateStepCostUsd(s.model, s.usage))),
  };
}
