import { readFileSync } from "node:fs";
import {
  runAgent,
  createLlmFromEnv,
  createKnowledgeRetrieverFromEnv,
  type EmailInput,
} from "../../../packages/agents/src/index.js";
import { formatAgentOutput } from "./format.js";

/**
 * CLI: `quoteagent <email.json>`. The JSON may be a plain {from,subject,body} or a golden-set
 * fixture (which nests those under `input`). Uses whichever LLM the environment configures (any
 * provider — see llm/resolve.ts); with no provider configured it runs in DEMO mode, replaying
 * recorded model responses for the bundled example emails, so a fresh clone works with no keys.
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
  const llm = createLlmFromEnv();
  if (llm.mode === "demo") {
    console.log("DEMO MODE — replaying recorded model responses (no API key set). Pricing, gate and guards run live.\n");
  }
  // The engine keeps its default; the knowledge retriever is env-gated (ungrounded if unset).
  const output = await runAgent(email, llm.client, undefined, llm.routing, createKnowledgeRetrieverFromEnv());
  console.log(formatAgentOutput(output));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
