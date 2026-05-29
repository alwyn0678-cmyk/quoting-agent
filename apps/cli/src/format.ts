import type { AgentOutput } from "../../../packages/agents/src/index.js";

/**
 * Renders an AgentOutput for the terminal. A quote prints the drafted reply plus a one-line
 * machine summary; an escalation prints the reason and NO draft. Both paths print the
 * token/cost line (the Phase 0 observability evidence).
 */
export function formatAgentOutput(o: AgentOutput): string {
  const lines: string[] = [];

  if (o.decision === "quote" && o.draft && o.quote) {
    lines.push("=== DRAFT REPLY (for human review) ===");
    lines.push(`Subject: ${o.draft.subject}`);
    lines.push("");
    lines.push(o.draft.body);
    lines.push("");
    lines.push(
      `[quote] ${o.quote.container_qty} x ${o.quote.container_type} ${o.quote.lane} — ` +
        `all-in EUR ${o.quote.all_in_total} (valid through ${o.quote.validity_through}, ` +
        `rate card ${o.quote.rate_card_version})`,
    );
  } else {
    lines.push("=== ESCALATED TO HUMAN — no quote sent ===");
    lines.push(`Reason: ${o.escalation_reason}`);
  }

  if (o.injection_flag) {
    lines.push("[flag] prompt-injection detected in the inbound email");
  }

  lines.push(
    `[usage] model=${o.usage.model} in=${o.usage.input_tokens} out=${o.usage.output_tokens} ` +
      `est_cost_usd=${o.usage.est_cost_usd}`,
  );

  return lines.join("\n");
}
