import { resolve } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { chunkCorpus } from "../packages/agents/src/chunk-corpus.js";
import { GeminiEmbeddingClient } from "../packages/agents/src/gemini-embedding-client.js";
import { InMemoryKnowledgeRetriever } from "../packages/agents/src/knowledge-retriever.js";

/**
 * LIVE pass-band eval (deferred): real Gemini Embedding 2 over the corpus must surface the relevant
 * chunk for a structured query. Run with GEMINI_API_KEY set: `npm run eval:rag`.
 */
async function main(): Promise<void> {
  const gkey = process.env.GEMINI_API_KEY;
  if (!gkey) throw new Error("GEMINI_API_KEY required for the live RAG eval");
  const dir = resolve(process.cwd(), "knowledge");
  const chunks = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .flatMap((f) => chunkCorpus(readFileSync(resolve(dir, f), "utf8"), f.replace(/\.md$/, "")));

  const retriever = new InMemoryKnowledgeRetriever(chunks, new GeminiEmbeddingClient(gkey));
  const cases: { query: string; expectTitle: string }[] = [
    { query: "What is the BAF surcharge and how is it charged?", expectTitle: "BAF" },
    { query: "What does the incoterm FOB mean for this quote?", expectTitle: "FOB" },
    { query: "How long is a quoted rate valid?", expectTitle: "Validity" },
  ];

  let pass = 0;
  for (const c of cases) {
    const top3 = (await retriever.retrieve(c.query, 3)).map((x) => x.title);
    const hit = top3.includes(c.expectTitle);
    if (hit) pass++;
    console.log(`${hit ? "PASS" : "FAIL"} "${c.query}" -> [${top3.join(", ")}] (want ${c.expectTitle})`);
  }
  console.log(`RAG retrieval: ${pass}/${cases.length}`);
  if (pass < cases.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
