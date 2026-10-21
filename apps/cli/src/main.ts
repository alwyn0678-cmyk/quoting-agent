import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createLlmFromEnv } from "../../../packages/agents/src/index.js";
import { runAgentV2 } from "../../../packages/agents/src/pipeline/run.js";
import { offlineTenant } from "../../../packages/agents/src/pipeline/tenant.js";
import type { EmailInput } from "../../../packages/agents/src/pipeline/extract.js";
import { formatAgentOutput } from "./format.js";

const USAGE = `usage: quoteagent <email.json> [--tenant <id>] [--as-of YYYY-MM-DD]

  --tenant   legacy (default: the Linkport demo rate card, EUR) or a mock-world forwarder:
             linkport, elbkai, prairiegate, lumenstrait, kopjeveld, ventoleste
  --as-of    pricing date (default: today, UTC)`;

/**
 * CLI: the JSON may be a plain {from,subject,body} or a golden-set fixture (which nests those under
 * `input` and may name its `tenant` and `as_of`). Uses whichever LLM the environment configures (any
 * provider — see llm/resolve.ts); with no provider configured it runs in DEMO mode, replaying recorded
 * model responses for the bundled example emails, so a fresh clone works with no keys.
 */
function loadEmail(path: string): { email: EmailInput; tenant?: string; asOf?: string } {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const e = ((parsed.input as Record<string, unknown> | undefined) ?? parsed) as Record<string, unknown>;
  if (typeof e.from !== "string" || typeof e.subject !== "string" || typeof e.body !== "string") {
    throw new Error("email JSON must have string fields: from, subject, body");
  }
  return {
    email: { from: e.from, subject: e.subject, body: e.body },
    tenant: typeof parsed.tenant === "string" ? parsed.tenant : undefined,
    asOf: typeof parsed.as_of === "string" ? parsed.as_of : undefined,
  };
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { tenant: { type: "string" }, "as-of": { type: "string" }, help: { type: "boolean", short: "h" } },
  });
  if (values.help || positionals.length !== 1) {
    console.error(USAGE);
    process.exit(values.help ? 0 : 1);
  }
  const file = loadEmail(positionals[0]!);
  const { tenant, tariffs } = offlineTenant(values.tenant ?? file.tenant ?? "legacy");
  const llm = createLlmFromEnv();
  if (llm.mode === "demo") {
    console.log("DEMO MODE — replaying recorded model responses (no API key set). Gate, pricing, guard and rendering run live.\n");
  }
  const output = await runAgentV2(file.email, { llm: llm.client, routing: llm.routing, tariffs, tenant }, { asOf: values["as-of"] ?? file.asOf });
  console.log(formatAgentOutput(output));
  if (llm.mode === "demo") {
    console.log("[demo] usage above is from the recorded run — no tokens were spent now.");
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
