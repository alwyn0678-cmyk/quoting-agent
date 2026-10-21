import { majorOf, type AgentOutputV2 } from "../../../packages/agents/src/pipeline/output.js";

/**
 * Renders an AgentOutput (v2) for the terminal. A quote prints the code-rendered reply plus one
 * machine summary line per presented option; an escalation prints the named reason, the fields a
 * clarification would ask for, and NO draft. Both paths print the token/cost line.
 */
export function formatAgentOutput(o: AgentOutputV2): string {
  const lines: string[] = [];

  if (o.decision === "quote" && o.draft && o.quote_view) {
    lines.push("=== DRAFT REPLY (for human review) ===");
    lines.push(`Subject: ${o.draft.subject}`);
    lines.push("");
    lines.push(o.draft.body);
    lines.push("");
    o.quote_view.options.forEach((opt, i) => {
      lines.push(
        `[option ${i + 1}] ${opt.mode} ${opt.route} — ${opt.total.currency} ${majorOf(opt.total)} ` +
          `(valid until ${opt.valid_until}${opt.carrier_label ? `, ${opt.carrier_label}` : ""})`,
      );
    });
    lines.push(`[pricing] ${o.outcome.options_presented} presented of ${o.outcome.candidates} priced options`);
  } else {
    lines.push("=== ESCALATED TO HUMAN — no quote sent ===");
    lines.push(`Reason: ${o.escalation_reason}${o.detail ? ` — ${o.detail}` : ""}`);
    if (o.missing_fields.length > 0) lines.push(`Ask the customer for: ${o.missing_fields.join(", ")}`);
  }

  if (o.injection_flag) {
    lines.push("[flag] prompt-injection detected in the inbound email");
  }

  lines.push(
    `[usage] model=${o.usage.model} in=${o.usage.input_tokens} out=${o.usage.output_tokens} ` +
      `est_cost_usd=${o.usage.est_cost_usd ?? "unknown"}`,
  );

  return lines.join("\n");
}
