import { describe, it, expect } from "vitest";
import { GeminiEmbeddingClient, type FetchLike } from "./gemini-embedding-client.js";
import { EMBEDDING_DIMS } from "./config.js";

type Captured = { url?: string; init?: Parameters<FetchLike>[1] };

function fakeFetch(captured: Captured, vector: number[]): FetchLike {
  return async (url, init) => {
    captured.url = url;
    captured.init = init;
    return {
      ok: true,
      status: 200,
      json: async () => ({ embedding: { values: vector } }),
      text: async () => "",
    };
  };
}

describe("Q3 GeminiEmbeddingClient (fake fetch)", () => {
  it("calls the model endpoint with the key header, task instruction, and outputDimensionality", async () => {
    const cap: Captured = {};
    const client = new GeminiEmbeddingClient("KEY123", fakeFetch(cap, new Array(EMBEDDING_DIMS).fill(0.1)));
    const [vec] = await client.embed(["what is BAF"], "query");

    expect(vec?.length).toBe(EMBEDDING_DIMS);
    expect(cap.url).toContain("models/gemini-embedding-2:embedContent");
    expect(cap.init?.headers["x-goog-api-key"]).toBe("KEY123");
    const body = JSON.parse(cap.init?.body ?? "{}");
    expect(body.outputDimensionality).toBe(EMBEDDING_DIMS); // camelCase REST field (Gate-4 fix #2)
    expect(body.output_dimensionality).toBeUndefined(); // the snake_case form must NOT be sent
    expect(body.content.parts[0].text).toContain("search query"); // query task instruction (audit fix: was "search result")
    expect(body.content.parts[0].text).toContain("what is BAF");
  });

  it("throws on a non-2xx response", async () => {
    const fetchErr: FetchLike = async () => ({
      ok: false,
      status: 429,
      json: async () => ({}),
      text: async () => "rate limited",
    });
    const client = new GeminiEmbeddingClient("K", fetchErr);
    await expect(client.embed(["x"], "query")).rejects.toThrow(/429/);
  });

  it("throws when the returned vector has the wrong dimension", async () => {
    const cap: Captured = {};
    const client = new GeminiEmbeddingClient("K", fakeFetch(cap, [0.1, 0.2, 0.3]));
    await expect(client.embed(["x"], "document")).rejects.toThrow(/dims/);
  });
});
