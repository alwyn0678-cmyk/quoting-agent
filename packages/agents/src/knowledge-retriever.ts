import { cosineRank, type EmbeddingClient } from "./embedding-client.js";
import type { KnowledgeChunk } from "./chunk-corpus.js";
import type { RateQuote } from "./schemas.js";

/** Retrieval port: given a query, return the top-k trusted knowledge chunks. */
export interface KnowledgeRetriever {
  retrieve(query: string, k: number): Promise<KnowledgeChunk[]>;
}

/**
 * Build the retrieval query from TRUSTED STRUCTURED fields only — the quote's surcharge/fee codes, the
 * incoterm, the lane and container. The raw (untrusted) email is never used, preserving the injection
 * boundary: nothing the attacker wrote can steer retrieval.
 */
export function buildRetrievalQuery(quote: RateQuote, incoterm: string | null): string {
  const codes = [
    ...quote.surcharges.map((s) => s.code),
    ...quote.per_shipment_fees.map((f) => f.code),
  ];
  return [
    `Explain the freight charges and terms for lane ${quote.lane},`,
    `container ${quote.container_type}:`,
    codes.join(", "),
    incoterm ? `incoterm ${incoterm}` : "",
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
