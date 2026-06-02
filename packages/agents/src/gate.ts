import { RATE_CARD, isPriceableMode, type RateCard } from "./rate-card.js";
import type { ExtractionResult, EscalationReason } from "./schemas.js";

/**
 * Deterministic quote-vs-escalate gate (no LLM). Turns a validated ExtractionResult into a
 * decision using the documented rules in docs/SLICE.md. A "quote" decision guarantees the rate
 * engine can price the request: the gate applies the SAME mode/lane/container checks priceQuote()
 * does, against the engine-resolved `card` passed in, so when paired with price(req, card) the two
 * cannot disagree and priceQuote() will not throw downstream.
 *
 * Precedence (first failing check wins): identity (origin/destination) -> mode -> lane (card exists
 * AND matches) -> container type (present AND priced on the card) -> quantity -> confidence floor.
 * This ordering is what makes the golden-set escalation reasons come out as specified — e.g. an LCL
 * request with no container details reports out_of_scope_mode, not missing_required_field.
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

export function decide(x: ExtractionResult, card: RateCard | null = RATE_CARD): GateDecision {
  const escalate = (reason: EscalationReason): GateDecision => ({ decision: "escalate", reason });

  // 1. Identity fields needed to locate a lane at all.
  if (x.origin.port_code === null || x.destination.port_code === null) {
    return escalate("missing_required_field");
  }
  // 2. Mode: UNKNOWN = missing; a mode with no implemented pricing basis = out of scope.
  if (x.mode === "UNKNOWN") return escalate("missing_required_field");
  if (!isPriceableMode(x.mode)) return escalate("out_of_scope_mode");

  // 3. The (mode, lane) card must exist — resolved by the engine via cardFor and passed in.
  if (card === null) return escalate("out_of_scope_lane");

  // 3b. Re-validate the resolved card against the request. The gate never TRUSTS that the card
  // matches (e.g. the RATE_CARD default, or a card resolved for a different request): it applies the
  // SAME mode/lane checks priceQuote() does, so "quote ⇒ priceable" is provable from decide() alone.
  if (card.mode !== x.mode) return escalate("out_of_scope_mode");
  const lane = `${x.origin.port_code}-${x.destination.port_code}`;
  if (card.supported_lane !== lane) return escalate("out_of_scope_lane");

  // 4. Container type must be present and priced on THIS card (priceQuote rejects an unpriced type).
  if (x.container_type === null || x.container_type === "UNKNOWN") {
    return escalate("missing_required_field");
  }
  if (card.base_per_container[x.container_type] === undefined) {
    return escalate("out_of_scope_container");
  }
  // 5. Quantity must be present.
  if (x.container_qty === null) return escalate("missing_required_field");

  // 6. Everything present and in scope, but the model is unsure -> human review.
  if (x.overall_confidence < CONFIDENCE_THRESHOLD) return escalate("low_confidence");

  return { decision: "quote", reason: null };
}
