import { createClient } from "@supabase/supabase-js";
import { cosineRank, type EmbeddingClient } from "./embedding-client.js";
import { GeminiEmbeddingClient } from "./gemini-embedding-client.js";
import { LINKPORT_TENANT_ID } from "./config.js";
import type { KnowledgeChunk } from "./chunk-corpus.js";
import type { RateQuote } from "./schemas.js";

/** Retrieval port: given a query, return the top-k trusted knowledge chunks. */
export interface KnowledgeRetriever {
  retrieve(query: string, k: number): Promise<KnowledgeChunk[]>;
}

/** Incoterms 2020 three-letter codes — the allowlist for the one email-derived field that reaches the
 *  retrieval query. The quote codes/lane/container are engine-trusted; the incoterm is extracted from the
 *  (untrusted) email as a free string, so it is normalized to a known code before use — never passed
 *  verbatim. This stops arbitrary attacker text from reaching the embedding API or steering retrieval. */
const KNOWN_INCOTERMS = new Set([
  "EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP",
]);

function normalizeIncoterm(incoterm: string | null): string | null {
  if (!incoterm) return null;
  const code = incoterm.trim().toUpperCase();
  return KNOWN_INCOTERMS.has(code) ? code : null;
}

/**
 * Build the retrieval query from TRUSTED STRUCTURED fields only — the quote's surcharge/fee codes, the
 * (allowlist-normalized) incoterm, the lane and container. The raw (untrusted) email is never used, and
 * an out-of-allowlist incoterm is dropped, preserving the injection boundary: nothing the attacker wrote
 * can steer retrieval or reach the embedding API.
 */
export function buildRetrievalQuery(quote: RateQuote, incoterm: string | null): string {
  const codes = [
    ...quote.surcharges.map((s) => s.code),
    ...quote.per_shipment_fees.map((f) => f.code),
  ];
  const term = normalizeIncoterm(incoterm);
  return [
    `Explain the freight charges and terms for lane ${quote.lane},`,
    `container ${quote.container_type}:`,
    codes.join(", "),
    term ? `incoterm ${term}` : "",
  ]
    .filter((s) => s.length > 0)
    .join(" ");
}

/** Returns nothing — the env-absent default, so the draft is simply ungrounded (today's behaviour). */
export class EmptyRetriever implements KnowledgeRetriever {
  async retrieve(_query: string, _k: number): Promise<KnowledgeChunk[]> {
    return [];
  }
}

/**
 * In-memory cosine retriever: embeds the corpus once, ranks by cosine in JS. The hermetic test double
 * (with MockEmbeddingClient) AND a working no-DB mode (with GeminiEmbeddingClient).
 */
export class InMemoryKnowledgeRetriever implements KnowledgeRetriever {
  private embedded: { item: KnowledgeChunk; vec: number[] }[] | null = null;

  constructor(
    private readonly chunks: KnowledgeChunk[],
    private readonly embeddings: EmbeddingClient,
  ) {}

  private async ensure(): Promise<{ item: KnowledgeChunk; vec: number[] }[]> {
    if (!this.embedded) {
      const vecs = await this.embeddings.embed(this.chunks.map((c) => c.content), "document");
      this.embedded = this.chunks.map((item, i) => ({ item, vec: vecs[i] ?? [] }));
    }
    return this.embedded;
  }

  async retrieve(query: string, k: number): Promise<KnowledgeChunk[]> {
    const embedded = await this.ensure();
    const [qv] = await this.embeddings.embed([query], "query");
    return cosineRank(qv ?? [], embedded, k).map((r) => r.item);
  }
}

/** The narrow slice of a Supabase client this retriever uses — structural, so no supabase-js type dep. */
export interface KnowledgeRpc {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

/** Persistent retriever: embed the query, then cosine top-k via the match_knowledge SQL function. */
export class SupabaseKnowledgeRetriever implements KnowledgeRetriever {
  constructor(
    private readonly client: KnowledgeRpc,
    private readonly embeddings: EmbeddingClient,
    private readonly tenantId: string,
  ) {}

  async retrieve(query: string, k: number): Promise<KnowledgeChunk[]> {
    const [qv] = await this.embeddings.embed([query], "query");
    const { data, error } = await this.client.rpc("match_knowledge", {
      query_embedding: qv ?? [],
      p_tenant: this.tenantId,
      match_count: k,
    });
    if (error) throw error;
    return (data as { source: string; title: string; content: string }[]).map((r) => ({
      source: r.source,
      title: r.title,
      content: r.content,
    }));
  }
}

/**
 * Env-gated factory (stub-safe, like hasGraphEnv): returns a live Supabase+Gemini retriever only when
 * BOTH the Gemini key and the Supabase service_role env are present; otherwise an EmptyRetriever, so
 * the draft is simply ungrounded and nothing requires a key/DB.
 */
export function createKnowledgeRetrieverFromEnv(tenantId: string = LINKPORT_TENANT_ID): KnowledgeRetriever {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const gkey = process.env.GEMINI_API_KEY;
  if (!url || !key || !gkey) return new EmptyRetriever();
  return new SupabaseKnowledgeRetriever(createClient(url, key), new GeminiEmbeddingClient(gkey), tenantId);
}
