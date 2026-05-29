import { priceQuote, type PriceRequest } from "./rate-engine.js";
import { SYSTEM_CANARY } from "./config.js";
import type { ExtractionResult, RateQuote } from "./schemas.js";

/**
 * Deterministic, code-side corroboration that a prompt injection produced NO harmful outcome.
 * It does not try to *detect* injection (that is the model's injection_detected flag) — it
 * verifies the OUTCOMES the spec forbids (docs/ACCEPTANCE_TESTS.md T12):
 *
 *  1. canary_leak  — the system-prompt canary must never appear anywhere in the output
 *                    (if it does, the model leaked its system prompt).
 *  2. price_mismatch — the emitted quote total must equal an INDEPENDENT re-derivation from the
 *                    extracted request. Pricing is deterministic code, so an attacker-supplied
 *                    figure (e.g. EUR 1) can never match. This is defense-in-depth against any
 *                    tampering between pricing and output assembly.
 *
 * A violation is real harm -> the pipeline fails closed (Task 8). A *detected-but-harmless*
 * injection (guard safe) is quoted normally and flagged, per the quote-and-flag policy.
 */

export type GuardViolation = "canary_leak" | "price_mismatch";

export interface GuardInput {
  extraction: ExtractionResult;
  quote: RateQuote | null;
  draft: { subject: string; body: string } | null;
}

export interface GuardResult {
  safe: boolean;
  violations: GuardViolation[];
}

export function injectionGuard(input: GuardInput): GuardResult {
  const violations: GuardViolation[] = [];

  // 1. Canary leak: scan every string in the output (JSON.stringify reaches all fields).
  if (JSON.stringify(input).includes(SYSTEM_CANARY)) {
    violations.push("canary_leak");
  }

  // 2. Price integrity: re-derive the total from the extraction and require an exact match.
  if (input.quote !== null) {
    const req: PriceRequest = {
      origin_port_code: input.extraction.origin.port_code,
      destination_port_code: input.extraction.destination.port_code,
      mode: input.extraction.mode,
      container_type: input.extraction.container_type,
      container_qty: input.extraction.container_qty,
    };
    let recomputed: number | null = null;
    try {
      recomputed = priceQuote(req).all_in_total;
    } catch {
      recomputed = null; // a quote exists for an unpriceable request -> mismatch
    }
    if (recomputed === null || recomputed !== input.quote.all_in_total) {
      violations.push("price_mismatch");
    }
  }

  return { safe: violations.length === 0, violations };
}
