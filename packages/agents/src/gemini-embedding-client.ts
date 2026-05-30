import { GEMINI_EMBEDDING_MODEL, EMBEDDING_DIMS } from "./config.js";
import type { EmbeddingClient, EmbeddingTask } from "./embedding-client.js";

/** Minimal fetch shape (no DOM lib). Matches the graph-transport pattern. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

const defaultFetch: FetchLike = (url, init) =>
  (globalThis as unknown as { fetch: FetchLike }).fetch(url, init);

/** Gemini Embedding 2 has no task_type param — task is given as an in-prompt instruction. */
const TASK_INSTRUCTION: Record<EmbeddingTask, string> = {
  document: "task: retrieval document",
  query: "task: search result",
};

/**
 * Gemini Embedding 2 over REST. One request per text (ample for a ~50-chunk corpus + single queries).
 * 768-dim output (MRL-truncated, auto-normalized). The vector dimension is asserted, so a model/string
 * mismatch fails loudly rather than silently storing the wrong shape.
 */
export class GeminiEmbeddingClient implements EmbeddingClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = defaultFetch,
    private readonly model: string = GEMINI_EMBEDDING_MODEL,
  ) {
    if (!apiKey) throw new Error("GEMINI_API_KEY is required for Gemini embeddings");
  }

  async embed(texts: string[], task: EmbeddingTask): Promise<number[][]> {
    const out: number[][] = [];
    for (const text of texts) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent`;
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          content: { parts: [{ text: `${TASK_INSTRUCTION[task]} | query: ${text}` }] },
          // REST request bodies are camelCase (the snake_case form is Python-SDK only) — see
          // ai.google.dev/api/embeddings. Wrong casing makes the server fall back to the default
          // dimensionality, which the length assert below then rejects loudly. (Live path = VERIFY, G5.)
          outputDimensionality: EMBEDDING_DIMS,
        }),
      });
      if (!res.ok) {
        throw new Error(`Gemini embed failed: ${res.status} ${await res.text()}`);
      }
      const body = (await res.json()) as { embedding?: { values?: number[] } };
      const values = body.embedding?.values;
      if (!Array.isArray(values) || values.length !== EMBEDDING_DIMS) {
        throw new Error(`Gemini embed returned ${values?.length ?? "no"} dims, expected ${EMBEDDING_DIMS}`);
      }
      out.push(values);
    }
    return out;
  }
}

export function hasGeminiEnv(): boolean {
  return typeof process.env.GEMINI_API_KEY === "string" && process.env.GEMINI_API_KEY.length > 0;
}
