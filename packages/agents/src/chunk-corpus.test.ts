import { describe, it, expect } from "vitest";
import { chunkCorpus } from "./chunk-corpus.js";

describe("Q3-AC-R1 — chunkCorpus splits markdown into discrete chunks", () => {
  it("makes one chunk per ## heading, drops the doc title + blanks", () => {
    const md = [
      "# Surcharges",
      "",
      "## BAF",
      "Bunker Adjustment Factor: fuel cost recovery, per container.",
      "",
      "## ISPS",
      "Security surcharge, per container.",
      "",
    ].join("\n");
    expect(chunkCorpus(md, "surcharges")).toEqual([
      {
        source: "surcharges",
        title: "BAF",
        content: "## BAF\nBunker Adjustment Factor: fuel cost recovery, per container.",
      },
      { source: "surcharges", title: "ISPS", content: "## ISPS\nSecurity surcharge, per container." },
    ]);
  });

  it("returns no chunks for a doc with no ## headings", () => {
    expect(chunkCorpus("# Title\n\nsome intro text\n", "x")).toEqual([]);
  });
});
