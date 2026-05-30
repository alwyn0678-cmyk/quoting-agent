import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { chunkCorpus } from "../packages/agents/src/chunk-corpus.js";
import { GeminiEmbeddingClient } from "../packages/agents/src/gemini-embedding-client.js";
import { LINKPORT_TENANT_ID } from "../packages/agents/src/config.js";

const KNOWLEDGE_DIR = resolve(process.cwd(), "knowledge");

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const gkey = process.env.GEMINI_API_KEY;
  if (!url || !key || !gkey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / GEMINI_API_KEY required");
  }
  const db = createClient(url, key);
  const embeddings = new GeminiEmbeddingClient(gkey);

  const files = readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith(".md"));
  const chunks = files.flatMap((f) =>
    chunkCorpus(readFileSync(resolve(KNOWLEDGE_DIR, f), "utf8"), f.replace(/\.md$/, "")),
  );
  const vectors = await embeddings.embed(chunks.map((c) => c.content), "document");

  // pgvector accepts the JSON array via PostgREST; if your project rejects it, JSON.stringify(v).
  const rows = chunks.map((c, i) => ({
    tenant_id: LINKPORT_TENANT_ID,
    source: c.source,
    title: c.title,
    content: c.content,
    embedding: vectors[i],
  }));
  const { error } = await db
    .from("knowledge_chunks")
    .upsert(rows, { onConflict: "tenant_id,source,title" });
  if (error) throw error;
  console.log(`indexed ${rows.length} chunks from ${files.length} files`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
