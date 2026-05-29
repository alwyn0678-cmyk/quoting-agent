import { readFileSync } from "node:fs";
import { runAgent, AnthropicLlmClient, type EmailInput } from "../../../packages/agents/src/index.js";
import { formatAgentOutput } from "./format.js";

/**
 * Phase 0 CLI: `quoteagent <email.json>`. The JSON may be a plain {from,subject,body} or a
 * golden-set fixture (which nests those under `input`). Runs the live pipeline against the
 * pinned model (requires ANTHROPIC_API_KEY) and prints the draft or escalation + usage.
 */
function loadEmail(path: string): EmailInput {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  const candidate = (parsed as { input?: unknown }).input ?? parsed;
  const e = candidate as Record<string, unknown>;
  if (typeof e.from !== "string" || typeof e.subject !== "string" || typeof e.body !== "string") {
    throw new Error("email JSON must have string fields: from, subject, body");
  }
  return { from: e.from, subject: e.subject, body: e.body };
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: quoteagent <email.json>");
    process.exit(1);
  }
  const email = loadEmail(path);
  const client = new AnthropicLlmClient();
  const output = await runAgent(email, client);
  console.log(formatAgentOutput(output));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
