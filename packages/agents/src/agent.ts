import { extractRequest, type EmailInput } from "./extraction.js";
import { decide } from "./gate.js";
import { StaticCardRateEngine, type RateEngine } from "./rate-engine.js";
import { generateDraft } from "./draft.js";
import { injectionGuard } from "./injection-guard.js";
import { estimateCostUsd, SYSTEM_CANARY, PER_STEP_ROUTING, RAG_TOP_K, type ModelRouting } from "./config.js";
import { type KnowledgeRetriever, EmptyRetriever, buildRetrievalQuery } from "./knowledge-retriever.js";
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
export async function runAgent(
  email: EmailInput,
  client: LlmClient,
  engine: RateEngine = new StaticCardRateEngine(),
  routing: ModelRouting = PER_STEP_ROUTING,
  retriever: KnowledgeRetriever = new EmptyRetriever(),
): Promise<AgentOutput> {
  const { extraction, usage: extractionUsage } = await extractRequest(email, client, routing.extraction);

  // Build the price request once, resolve the active card for its (mode, lane), and gate against
  // THAT card — so the gate's "quote ⇒ priceable" guarantee holds for every mode/lane, not just the
  // FCL demo card. cardFor(...) returns null when no card matches → the gate escalates.
  const priceReq = {
    origin_port_code: extraction.origin.port_code,
    destination_port_code: extraction.destination.port_code,
    mode: extraction.mode,
    container_type: extraction.container_type,
    container_qty: extraction.container_qty,
  };
  const card = await engine.cardFor(priceReq);
  const gate = decide(extraction, card);

  // Track which LLM steps actually ran, so usage.model reports the truth (drafting fires only on
  // the quote path; on a gate-escalation only extraction runs).
  let draftCalled = false;

  let decision: "quote" | "escalate" = gate.decision;
  let escalationReason: EscalationReason | null = gate.reason;
  let quote: RateQuote | null = null;
  let draft: Draft | null = null;
  let draftUsage: Usage = { input_tokens: 0, output_tokens: 0 };

  if (gate.decision === "quote") {
    // Deterministic pricing via the injected engine. Price against the SAME card the gate validated
    // (gate.decision === "quote" ⇒ card !== null) — not a re-resolved one — so pricing cannot pick a
    // different card if the source mutates between gate and price. The gate already proved priceable.
    quote = await engine.price(priceReq, card);

    // Ground the reply prose in trusted knowledge retrieved from STRUCTURED quote fields (never the
    // raw email). Retrieval runs AFTER pricing and feeds only the draft — RAG never touches the price.
    // Grounding is OPTIONAL by design (EmptyRetriever is a valid retriever), so a retrieval failure
    // (embedding-API 429/503, RPC error) degrades to an ungrounded draft instead of crashing the run.
    let groundingContext: Awaited<ReturnType<KnowledgeRetriever["retrieve"]>> = [];
    try {
      groundingContext = await retriever.retrieve(
        buildRetrievalQuery(quote, extraction.incoterm),
        RAG_TOP_K,
      );
    } catch (err) {
      console.error("[agent] knowledge retrieval failed; drafting ungrounded:", err);
    }

    const drafted = await generateDraft(
      {
        requester_name: extraction.requester_name,
        requester_company: extraction.requester_company,
        origin_text: extraction.origin.raw,
        destination_text: extraction.destination.raw,
        commodity: extraction.commodity,
        quote,
        groundingContext,
      },
      client,
      routing.draft,
    );
    draftCalled = true;
    draft = drafted.draft;
    draftUsage = drafted.usage;

    // Fail closed on any injection-outcome violation (leak / price tampering). The guard
    // re-derives the price against the SAME gate-validated card the engine priced on.
    const guard = injectionGuard({ extraction, quote, draft, card });
    if (!guard.safe) {
      decision = "escalate";
      escalationReason = "guard_violation";
      quote = null;
      draft = null;
    }
  }

  const inputTokens = extractionUsage.input_tokens + draftUsage.input_tokens;
  const outputTokens = extractionUsage.output_tokens + draftUsage.output_tokens;

  const candidate = {
    decision,
    extraction,
    injection_flag: extraction.injection_detected,
    escalation_reason: escalationReason,
    quote,
    draft,
    usage: {
      // Honest: report the model(s) that actually ran (drafting fires only on the quote path).
      model: draftCalled
        ? `${routing.extraction} (extract), ${routing.draft} (draft)`
        : `${routing.extraction} (extract)`,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      est_cost_usd: estimateCostUsd(inputTokens, outputTokens),
    },
  };

  // Final safety net on EVERY path (incl. gate-escalations that never reach the injection guard):
  // the system canary must never appear in returned output. If a leak reached any field, redact it
  // and fail closed — this guarantees the "no canary in AgentOutput" invariant end to end.
  if (JSON.stringify(candidate).includes(SYSTEM_CANARY)) {
    const redacted = JSON.parse(JSON.stringify(candidate).split(SYSTEM_CANARY).join("[REDACTED]"));
    redacted.decision = "escalate";
    redacted.escalation_reason = "guard_violation";
    redacted.quote = null;
    redacted.draft = null;
    return AgentOutputSchema.parse(redacted);
  }
  return AgentOutputSchema.parse(candidate);
}
