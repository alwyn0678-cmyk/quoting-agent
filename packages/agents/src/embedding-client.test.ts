import { describe, it, expect } from "vitest";
import { MockEmbeddingClient, cosineRank } from "./embedding-client.js";

describe("Q3 embedding-client", () => {
  it("MockEmbeddingClient is deterministic and code-sensitive", async () => {
    const c = new MockEmbeddingClient();
    const [a1] = await c.embed(["Explain the BAF surcharge"], "query");
    const [a2] = await c.embed(["Explain the BAF surcharge"], "query");
    const [isps] = await c.embed(["## ISPS security"], "document");
    expect(a1).toEqual(a2); // deterministic
    expect(a1).not.toEqual(isps); // different content -> different vector
  });

  it("cosineRank returns the nearest items, highest score first", () => {
    const q = [1, 0, 0];
    const ranked = cosineRank(q, [
      { item: "far", vec: [0, 1, 0] },
      { item: "near", vec: [1, 0, 0] },
      { item: "mid", vec: [1, 1, 0] },
    ], 2);
    expect(ranked.map((r) => r.item)).toEqual(["near", "mid"]);
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);
  });
});
