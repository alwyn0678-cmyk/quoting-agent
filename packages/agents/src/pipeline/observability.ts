import { createHash } from "node:crypto";
import { toStrictJsonSchema } from "../llm/strict-json-schema.js";
import { DraftChoiceSchema } from "../../../core/src/draft/render.js";
import { buildExtractionSystemPrompt } from "./extract.js";
import { buildDraftChoiceSystemPrompt } from "./draft-choice.js";
import { ExtractionWireSchema } from "./extraction-wire.js";
import type { AgentOutputV2 } from "./output.js";

/**
 * Run observability (spec §14). PROMPT_VERSION fingerprints everything that shapes model behaviour —
 * both system prompts and both output schemas — so every run records which behaviour produced it
 * (CLAUDE.md invariant 8). The recorded cassettes key on the same material, so changing any of it
 * without re-recording fails the exact replay gate.
 */
export const PROMPT_VERSION = createHash("sha256")
  .update(
    JSON.stringify([
      buildExtractionSystemPrompt(),
      toStrictJsonSchema(ExtractionWireSchema),
      buildDraftChoiceSystemPrompt(),
      toStrictJsonSchema(DraftChoiceSchema),
    ]),
  )
  .digest("hex")
  .slice(0, 12);

/** One structured line per run: decision, reason, pricing counts, provenance, cost. Internal only (it
 *  carries tariff hashes and margin rule ids) — never email text, never amounts. */
export interface RunLogLine {
  event: "quote_run";
  tenant_id: string;
  request_id: string | null;
  owner: string | null;
  decision: AgentOutputV2["decision"];
  reason: AgentOutputV2["escalation_reason"];
  missing_fields: string[];
  injection_flag: boolean;
  candidates: number;
  presented: number;
  excluded_by_reason: Record<string, number>;
  fx_age_days: number | null;
  margin_rule_ids: string[];
  tariff_hashes: string[];
  models: string;
  input_tokens: number;
  output_tokens: number;
  est_cost_usd: number | null;
  prompt_version: string;
  duration_ms: number;
}

interface TraceWire {
  excluded?: { reason: string }[];
  fx_age_days?: number | null;
  margin_rule_ids?: string[];
}
interface PricingWire {
  trace?: TraceWire;
  candidates?: { legs?: { lines?: { receipt?: { content_hash?: string } }[] }[] }[];
}

export function runLogLine(
  out: AgentOutputV2,
  ctx: { tenant_id: string; request_id?: string | null; owner?: string | null; duration_ms: number },
): RunLogLine {
  const p = (out.pricing ?? {}) as PricingWire;
  const excluded: Record<string, number> = {};
  for (const e of p.trace?.excluded ?? []) excluded[e.reason] = (excluded[e.reason] ?? 0) + 1;
  const hashes = new Set<string>();
  for (const c of p.candidates ?? []) for (const l of c.legs ?? []) for (const x of l.lines ?? []) if (x.receipt?.content_hash) hashes.add(x.receipt.content_hash);
  return {
    event: "quote_run",
    tenant_id: ctx.tenant_id,
    request_id: ctx.request_id ?? null,
    owner: ctx.owner ?? null,
    decision: out.decision,
    reason: out.escalation_reason,
    missing_fields: out.missing_fields,
    injection_flag: out.injection_flag,
    candidates: out.outcome.candidates,
    presented: out.outcome.options_presented,
    excluded_by_reason: excluded,
    fx_age_days: p.trace?.fx_age_days ?? null,
    margin_rule_ids: p.trace?.margin_rule_ids ?? [],
    tariff_hashes: [...hashes].sort(),
    models: out.usage.model,
    input_tokens: out.usage.input_tokens,
    output_tokens: out.usage.output_tokens,
    est_cost_usd: out.usage.est_cost_usd,
    prompt_version: out.prompt_version,
    duration_ms: ctx.duration_ms,
  };
}
