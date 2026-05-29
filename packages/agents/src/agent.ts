import { extractRequest, type EmailInput } from "./extraction.js";
import { decide } from "./gate.js";
import { priceQuote } from "./rate-engine.js";
import { generateDraft } from "./draft.js";
import { injectionGuard } from "./injection-guard.js";
import { MODEL, estimateCostUsd } from "./config.js";
import {
  AgentOutputSchema,
  type AgentOutput,
  type RateQuote,
  type Draft,
  type EscalationReason,
} from "./schemas.js";
import type { LlmClient, Usage } from "./llm.js";

/**
 * The full Phase 0 pipeline for ONE email: extract (LLM) -> gate (code) -> price (code) ->
 * draft (LLM) -> injection guard (code). Pure orchestration, no IO — the CLI handles input and
 * presentation. Token usage is summed across both LLM calls. On a guard violation the pipeline
 * FAILS CLOSED: the quote and draft are dropped and the request is escalated.
 */
export async function runAgent(email: EmailInput, client: LlmClient): Promise<AgentOutput> {
  const { extraction, usage: extractionUsage } = await extractRequest(email, client);
  const gate = decide(extraction);

  let decision: "quote" | "escalate" = gate.decision;
  let escalationReason: EscalationReason | null = gate.reason;
  let quote: RateQuote | null = null;
  let draft: Draft | null = null;
  let draftUsage: Usage = { input_tokens: 0, output_tokens: 0 };

  if (gate.decision === "quote") {
    // Deterministic pricing (the gate guarantees this is priceable).
    quote = priceQuote({
      origin_port_code: extraction.origin.port_code,
      destination_port_code: extraction.destination.port_code,
      mode: extraction.mode,
      container_type: extraction.container_type,
      container_qty: extraction.container_qty,
    });

    const drafted = await generateDraft(
      {
        requester_name: extraction.requester_name,
        requester_company: extraction.requester_company,
        origin_text: extraction.origin.raw,
        destination_text: extraction.destination.raw,
        commodity: extraction.commodity,
        quote,
      },
      client,
    );
    draft = drafted.draft;
    draftUsage = drafted.usage;

    // Fail closed on any injection-outcome violation (leak / price tampering).
    const guard = injectionGuard({ extraction, quote, draft });
    if (!guard.safe) {
      decision = "escalate";
      escalationReason = "guard_violation";
      quote = null;
      draft = null;
    }
  }

  const inputTokens = extractionUsage.input_tokens + draftUsage.input_tokens;
  const outputTokens = extractionUsage.output_tokens + draftUsage.output_tokens;

  return AgentOutputSchema.parse({
    decision,
    extraction,
    injection_flag: extraction.injection_detected,
    escalation_reason: escalationReason,
    quote,
    draft,
    usage: {
      model: MODEL,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      est_cost_usd: estimateCostUsd(inputTokens, outputTokens),
    },
  });
}
