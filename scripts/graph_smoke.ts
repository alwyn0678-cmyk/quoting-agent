import { GraphFetchTransport, createOutlookMailboxFromEnv } from "../packages/graph/src/graph-transport.js";

/**
 * Live, read-only smoke check for the Graph mail poll (NOT a CI test — needs real credentials).
 *   node --env-file=.env --import tsx scripts/graph_smoke.ts --folders   # list folder ids -> names
 *   node --env-file=.env --import tsx scripts/graph_smoke.ts             # list the configured folder
 */
async function main(): Promise<void> {
  const user = process.env.GRAPH_MAILBOX_USER;
  if (process.argv[2] === "--folders") {
    if (!process.env.GRAPH_TENANT_ID || !process.env.GRAPH_CLIENT_ID || !process.env.GRAPH_CLIENT_SECRET || !user) {
      throw new Error("GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET / GRAPH_MAILBOX_USER required");
    }
    const transport = new GraphFetchTransport({
      tenantId: process.env.GRAPH_TENANT_ID,
      clientId: process.env.GRAPH_CLIENT_ID,
      clientSecret: process.env.GRAPH_CLIENT_SECRET,
    });
    const res = (await transport.get(`/users/${encodeURIComponent(user)}/mailFolders?$top=100&$select=id,displayName`)) as {
      value: { id: string; displayName: string }[];
    };
    console.log("displayName\tid  (copy the 'Quote requests' id into GRAPH_QUOTE_FOLDER)");
    for (const f of res.value) console.log(`${f.displayName}\t${f.id}`);
    return;
  }

  const box = createOutlookMailboxFromEnv();
  const { messages, cursor } = await box.listSince("1970-01-01T00:00:00Z");
  console.log(`folder read OK — ${messages.length} message(s); next cursor ${cursor}`);
  for (const m of messages) console.log(`- ${m.receivedDateTime}  ${m.from}  | ${m.subject}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
