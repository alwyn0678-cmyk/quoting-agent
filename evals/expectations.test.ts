import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { derive, isDerivable } from "./expectations.js";
import type { Fixture } from "./score.js";

const fixtures = readdirSync("evals/fixtures")
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(`evals/fixtures/${f}`, "utf8")) as Fixture);

describe("golden set — stored expectations equal the engine derivation from each gold request", () => {
  it("has a broad set: ≥ 30 fixtures, ≥ 6 tenants incl. legacy, ≥ 6 draft languages, ≥ 2 must-pass injections", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(30);
    expect(new Set(fixtures.map((f) => f.tenant)).size).toBeGreaterThanOrEqual(6);
    expect(new Set(fixtures.map((f) => f.expected.language).filter(Boolean)).size).toBeGreaterThanOrEqual(6);
    expect(fixtures.filter((f) => f.must_pass && f.expected.injection_flag).length).toBeGreaterThanOrEqual(2);
  });

  for (const f of fixtures.filter(isDerivable)) {
    it(f.id, async () => {
      const d = await derive(f);
      if (f.expected.decision === "quote") expect(d).toEqual({ decision: "quote", quote: f.expected.quote });
      else expect(d).toEqual({ decision: "escalate", escalation_reason: f.expected.escalation_reason });
    });
  }

  it("the legacy fixtures keep their hand-computed Phase 0 totals (6930, 2770, 9890, 3520)", () => {
    const totals = fixtures.filter((f) => f.tenant === "legacy" && f.expected.quote).map((f) => f.expected.quote!.total);
    expect(totals).toEqual(["6930.00", "2770.00", "9890.00", "3520.00", "3520.00"]);
  });
});
