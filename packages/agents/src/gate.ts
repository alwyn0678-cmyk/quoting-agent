import { RATE_CARD, type RateCard } from "./rate-card.js";
import type { ExtractionResult, EscalationReason } from "./schemas.js";

/**
 * Deterministic quote-vs-escalate gate (no LLM). Turns a validated ExtractionResult into a
 * decision using the documented rules in docs/SLICE.md. A "quote" decision guarantees the rate
 * engine can price the request (in-scope mode + lane + container + present qty), so priceQuote()
 * will not throw downstream.
 *
 * Precedence (first failing check wins): identity (origin/destination) -> mode -> lane ->
 * container type -> quantity -> confidence floor. This ordering is what makes the golden-set
 * escalation reasons come out as specified — e.g. an LCL request with no container details
 * reports out_of_scope_mode, not missing_required_field.
 *
 * Phase 0 emits a subset of the reason taxonomy; `ambiguous_request` is reserved for Phase 1+.
 * Injection handling is separate (Task 6); the gate ignores injection_detected because the
 * policy is quote-and-flag, not escalate-on-injection.
 */

/** Overall-confidence floor below which we escalate to a human. ASSUMPTIONS.md E1. */
export const CONFIDENCE_THRESHOLD = 0.75;

export interface GateDecision {
  decision: "quote" | "escalate";
  reason: EscalationReason | null;
}

export function decide(x: ExtractionResult, card: RateCard = RATE_CARD): GateDecision {
  const escalate = (reason: EscalationReason): GateDecision => ({ decision: "escalate", reason });

  // 1. Identity fields needed to locate a lane at all.
  if (x.origin.port_code === null || x.destination.port_code === null) {
    return escalate("missing_required_field");
  }
  // 2. Mode (FCL-only slice).
  if (x.mode === "UNKNOWN") return escalate("missing_required_field");
  if (x.mode !== "FCL") return escalate("out_of_scope_mode");

  // 3. Lane must be in the rate card.
  const lane = `${x.origin.port_code}-${x.destination.port_code}`;
  if (lane !== card.supported_lane) return escalate("out_of_scope_lane");

  // 4. Container type must be present and priceable.
  if (x.container_type === null || x.container_type === "UNKNOWN") {
    return escalate("missing_required_field");
  }
  // 5. Quantity must be present.
  if (x.container_qty === null) return escalate("missing_required_field");

  // 6. Everything present and in scope, but the model is unsure -> human review.
  if (x.overall_confidence < CONFIDENCE_THRESHOLD) return escalate("low_confidence");

  return { decision: "quote", reason: null };
}
