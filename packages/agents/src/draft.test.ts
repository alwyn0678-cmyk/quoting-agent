import { describe, it, expect } from "vitest";
import {
  generateDraft,
  buildDraftSystemPrompt,
  buildDraftUserContent,
  verifyDraftStatesTotal,
  type DraftInput,
} from "./draft.js";
import { MockLlmClient } from "./mock-llm.js";
import { priceQuote } from "./rate-engine.js";
import { SYSTEM_CANARY } from "./config.js";
import type { KnowledgeChunk } from "./chunk-corpus.js";

const quote = priceQuote({
  origin_port_code: "NLRTM",
  destination_port_code: "USNYC",
  mode: "FCL",
  container_type: "40HC",
  container_qty: 2,
}); // all_in_total = 6930

const input: DraftInput = {
  requester_name: "Maria Jansen",
  requester_company: "Apex Coffee Importers",
  origin_text: "Rotterdam",
  destination_text: "New York",
  commodity: "roasted coffee",
  quote,
};

const usage = { input_tokens: 200, output_tokens: 120 };

describe("draft wiring (mocked client)", () => {
  it("parses a valid draft and propagates usage", async () => {
    const mock = new MockLlmClient({
      data: { subject: "Re: Quote request", body: "Dear Maria, our all-in rate is EUR 6,930." },
      usage,
    });
    const out = await generateDraft(input, mock);
    expect(out.draft.subject).toContain("Quote");
    expect(out.usage).toEqual(usage);
  });

  it("rejects a structurally invalid draft", async () => {
    const mock = new MockLlmClient({ data: { subject: "only subject" }, usage });
    await expect(generateDraft(input, mock)).rejects.toThrow();
  });

  it("passes the exact all-in figure and a verbatim instruction to the model", () => {
    const uc = buildDraftUserContent(input);
    expect(uc).toContain("6930");
    expect(uc.toUpperCase()).toContain("EXACTLY");
    expect(uc).toContain("Maria Jansen");
  });

  it("plants the leak canary in the draft system prompt", () => {
    expect(buildDraftSystemPrompt()).toContain(SYSTEM_CANARY);
  });
});

describe("verifyDraftStatesTotal (T10 mechanism)", () => {
  it("matches the total across currency formats", () => {
    for (const s of [
      "Our all-in rate is €6,930.",
      "Total: 6.930,00 EUR",
      "EUR 6,930.00 all in",
      "the figure is 6930 euros",
    ]) {
      expect(verifyDraftStatesTotal(s, 6930)).toBe(true);
    }
  });

  it("rejects a drifted/wrong total", () => {
    expect(verifyDraftStatesTotal("Our rate is €6,940.", 6930)).toBe(false);
    expect(verifyDraftStatesTotal("Our rate is €1.", 6930)).toBe(false);
  });

  it("is not fooled by surrounding numbers (date, qty, container)", () => {
    const body = "Dear Maria, 2 x 40HC, valid through 2026-06-30, all-in EUR 6,930.";
    expect(verifyDraftStatesTotal(body, 6930)).toBe(true);
  });
});

describe("Q3-AC-R4 — draft grounding block", () => {
  const grounded: DraftInput = {
    ...input,
    groundingContext: [
      { source: "surcharges", title: "BAF", content: "## BAF\nBunker Adjustment Factor recovers fuel cost." } as KnowledgeChunk,
    ],
  };

  it("includes the reference-knowledge block (title + body) when grounding is supplied", () => {
    const uc = buildDraftUserContent(grounded);
    expect(uc).toContain("Reference knowledge");
    expect(uc).toContain("BAF");
    expect(uc).toContain("Bunker Adjustment Factor recovers fuel cost.");
  });

  it("omits the block when there is no grounding (unchanged behaviour)", () => {
    expect(buildDraftUserContent(input)).not.toContain("Reference knowledge");
  });
});
