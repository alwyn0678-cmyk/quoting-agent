import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chunkCorpus } from "./chunk-corpus.js";

const read = (f: string) => readFileSync(resolve(process.cwd(), "knowledge", f), "utf8");

describe("Q3 corpus coverage", () => {
  it("the surcharge glossary has an entry titled by every code used on the rate sheets", () => {
    const codes = [
      "BAF", "CAF", "THC_RTM", "THC_NYC", "THC_LAX", "THC_HAM",
      "ISPS", "PSS", "CONGESTION", "DOC", "EXPORT_CUSTOMS",
    ];
    const titles = new Set(chunkCorpus(read("surcharges.md"), "surcharges").map((c) => c.title));
    for (const code of codes) expect(titles).toContain(code);
  });

  it("each corpus file chunks into at least one entry", () => {
    for (const f of ["surcharges.md", "incoterms.md", "policy.md", "lanes.md"]) {
      expect(chunkCorpus(read(f), f).length).toBeGreaterThan(0);
    }
  });
});
