/**
 * Embedding port. The agent retriever + the indexer depend on this, not on a provider, so retrieval
 * is hermetically testable with MockEmbeddingClient and exercised live with GeminiEmbeddingClient.
 * `task` becomes an in-prompt instruction for Gemini Embedding 2 (which has no task_type param).
 */
export type EmbeddingTask = "document" | "query";

export interface EmbeddingClient {
  /** Embed each text; returns one vector per input, in order. */
  embed(texts: string[], task: EmbeddingTask): Promise<number[][]>;
}

/** Pure top-k by cosine similarity, highest first. Equal-length vectors assumed (same client). */
export function cosineRank<T>(
  queryVec: number[],
  items: { item: T; vec: number[] }[],
  k: number,
): { item: T; score: number }[] {
  const scored = items.map(({ item, vec }) => ({ item, score: cosine(queryVec, vec) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Deterministic test double: a word-presence bag over a fixed vocabulary of codes/terms, so a "BAF"
 * query embeds nearest a chunk that mentions BAF. No network, no key — makes retrieval tests hermetic.
 */
const VOCAB = [
  "baf", "caf", "thc", "rtm", "nyc", "lax", "ham", "isps", "pss", "congestion", "doc", "customs",
  "incoterm", "fob", "cif", "exw", "dap", "rotterdam", "york", "angeles", "hamburg", "validity",
];

export class MockEmbeddingClient implements EmbeddingClient {
  async embed(texts: string[], _task: EmbeddingTask): Promise<number[][]> {
    return texts.map((t) => {
      const tokens = new Set(t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
      return VOCAB.map((term) => (tokens.has(term) ? 1 : 0));
    });
  }
}
