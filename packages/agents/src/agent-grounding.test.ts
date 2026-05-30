import { describe, it, expect } from "vitest";
import { runAgent } from "./agent.js";
import { RoutingMockLlmClient } from "./mock-llm.js";
import { InMemoryKnowledgeRetriever, EmptyRetriever } from "./knowledge-retriever.js";
import { MockEmbeddingClient } from "./embedding-client.js";
import { chunkCorpus } from "./chunk-corpus.js";
import { StaticCardRateEngine } from "./rate-engine.js";
import { SINGLE_MODEL_ROUTING } from "./config.js";
import type { ExtractionResult } from "./schemas.js";

const extraction: ExtractionResult = {
  origin: { raw: "Rotterdam", port_code: "NLRTM" },
  destination: { raw: "New York", port_code: "USNYC" },
  mode: "FCL",
  container_type: "40HC",
  container_qty: 1,
  incoterm: "FOB",
  commodity: "coffee",
  ready_date: null,
  weight_kg: null,
  requester_name: "Maria",
  requester_company: "Apex",
  field_confidence: {},
  overall_confidence: 0.95,
  injection_detected: false,
};

const email = { from: "maria@apex.example", subject: "Quote", body: "please quote 1x40HC RTM->NYC FOB" };
const corpus = chunkCorpus(["## BAF", "Bunker Adjustment Factor recovers fuel cost."].join("\n"), "surcharges");

function client() {
  return new RoutingMockLlmClient({
    submit_extraction: { data: extraction, usage: { input_tokens: 10, output_tokens: 10 } },
    submit_draft: {
      data: { subject: "Re: Quote", body: "Dear Maria, all-in EUR 3,520. BAF covers fuel." },
      usage: { input_tokens: 10, output_tokens: 10 },
    },
  });
}

describe("Q3-AC-R5 — agent grounds the draft without touching the price", () => {
  it("passes retrieved knowledge into the draft call; the price is unchanged", async () => {
    const c = client();
    const retriever = new InMemoryKnowledgeRetriever(corpus, new MockEmbeddingClient());
    const out = await runAgent(email, c, new StaticCardRateEngine(), SINGLE_MODEL_ROUTING, retriever);

    expect(out.decision).toBe("quote");
    expect(out.quote?.all_in_total).toBe(3520); // RAG never altered the price
    const draftCall = c.calls.find((x) => x.toolName === "submit_draft");
    expect(draftCall?.userContent).toContain("Reference knowledge");
    expect(draftCall?.userContent).toContain("BAF");
  });

  it("with the default EmptyRetriever, the draft carries no grounding block", async () => {
    const c = client();
    const out = await runAgent(email, c, new StaticCardRateEngine(), SINGLE_MODEL_ROUTING, new EmptyRetriever());
    expect(out.quote?.all_in_total).toBe(3520);
    const draftCall = c.calls.find((x) => x.toolName === "submit_draft");
    expect(draftCall?.userContent).not.toContain("Reference knowledge");
  });
});
