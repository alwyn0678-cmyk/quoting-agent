import { describe, it, expect } from "vitest";
import {
  buildRetrievalQuery,
  InMemoryKnowledgeRetriever,
  EmptyRetriever,
} from "./knowledge-retriever.js";
import { MockEmbeddingClient } from "./embedding-client.js";
import { chunkCorpus } from "./chunk-corpus.js";
import { priceQuote } from "./rate-engine.js";

const CORPUS = chunkCorpus(
  ["## BAF", "Bunker Adjustment Factor recovers fuel cost.", "", "## ISPS", "Security surcharge."].join("\n"),
  "surcharges",
);

describe("Q3-AC-R2 — buildRetrievalQuery uses structured fields only", () => {
  it("includes every code + the incoterm + the lane, and no email text", () => {
    const quote = priceQuote({
      origin_port_code: "NLRTM",
      destination_port_code: "USNYC",
      mode: "FCL",
      container_type: "40HC",
      container_qty: 1,
    });
    const q = buildRetrievalQuery(quote, "FOB");
    for (const code of ["BAF", "THC_RTM", "THC_NYC", "ISPS", "DOC", "EXPORT_CUSTOMS"]) {
      expect(q).toContain(code);
    }
    expect(q).toContain("FOB");
    expect(q).toContain("NLRTM-USNYC");
    expect(q.toLowerCase()).not.toContain("dear linkport"); // no raw-email phrasing can leak in
  });
});

describe("Q3-AC-R3 — deterministic retrieval (in-memory + mock)", () => {
  it("retrieves the BAF chunk for a BAF query", async () => {
    const r = new InMemoryKnowledgeRetriever(CORPUS, new MockEmbeddingClient());
    const hits = await r.retrieve("Explain the BAF surcharge", 1);
    expect(hits.map((c) => c.title)).toEqual(["BAF"]);
  });

  it("EmptyRetriever returns nothing", async () => {
    expect(await new EmptyRetriever().retrieve("anything", 5)).toEqual([]);
  });
});
