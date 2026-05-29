import { readFileSync } from "node:fs";
import { runAndPersist } from "../packages/ingest/src/run.js";
import { SupabaseRunStore, createServiceClient } from "../packages/ingest/src/supabase-store.js";
import {
  AnthropicLlmClient,
  createSupabaseRateEngine,
  LINKPORT_TENANT_ID,
  DEFAULT_LANE,
  type EmailInput,
} from "../packages/agents/src/index.js";

/**
 * Run ONE email through the live pipeline and persist it so it appears in the dashboard — the same
 * extract -> gate -> price -> draft -> atomic-persist the autonomous run-request task does, but
 * in-process (no Trigger.dev worker needed). Inserts the email as a 'paste' quote_request under the
 * Linkport demo tenant, then runAndPersist (live Anthropic + live Supabase rate card).
 *
 * Usage: node --env-file=.env --import tsx scripts/ingest_email.ts <email.json>
 * The JSON may be {from,subject,body} or a golden fixture ({input:{from,subject,body}}).
 */
function loadEmail(path: string): EmailInput {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  const e = ((parsed as { input?: unknown }).input ?? parsed) as Record<string, unknown>;
  if (typeof e.from !== "string" || typeof e.subject !== "string" || typeof e.body !== "string") {
    throw new Error("email JSON must have string fields: from, subject, body");
  }
  return { from: e.from, subject: e.subject, body: e.body };
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: node --env-file=.env --import tsx scripts/ingest_email.ts <email.json>");
    process.exit(1);
  }
  const email = loadEmail(path);
  const tenantId = LINKPORT_TENANT_ID;
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("quote_requests")
    .insert({ tenant_id: tenantId, source: "paste", from_email: email.from, subject: email.subject, body: email.body, status: "received" })
    .select("id")
    .single();
  if (error) throw error;
  const requestId = data.id as string;
  console.log(`ingested request ${requestId} (source=paste) — running the live pipeline...`);

  const summary = await runAndPersist(
    tenantId,
    requestId,
    { client: new AnthropicLlmClient(), engine: createSupabaseRateEngine(tenantId, DEFAULT_LANE) },
    new SupabaseRunStore(supabase),
  );

  console.log(JSON.stringify(summary, null, 2));
  console.log("Done — refresh the dashboard to see it.");
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
