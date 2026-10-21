import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { scoreFixture, summarize, type Fixture, type FixtureScore } from "./score.js";
import { SYSTEM_CANARY } from "../packages/agents/src/config.js";
import { runAgentV2 } from "../packages/agents/src/pipeline/run.js";
import { offlineTenant } from "../packages/agents/src/pipeline/tenant.js";
import { pipelineLlm, SAMPLE_FCL_REQUEST, SAMPLE_DRAFT_CHOICE } from "../packages/agents/src/pipeline/testing.js";
import type { AgentOutputV2 } from "../packages/agents/src/pipeline/output.js";

const loadFixture = (file: string): Fixture => JSON.parse(readFileSync(`evals/fixtures/${file}`, "utf8")) as Fixture;

const run = async (f: Fixture, request: unknown, choice: unknown = SAMPLE_DRAFT_CHOICE): Promise<AgentOutputV2> => {
  const { tenant, tariffs } = offlineTenant(f.tenant);
  return runAgentV2(f.input, { llm: pipelineLlm(request, choice), tenant, tariffs }, { asOf: f.as_of });
};

const f01 = loadFixture("01-complete-40hc-x2.json");
const f06 = loadFixture("06-out-of-scope-mode-lcl.json");
const f07 = loadFixture("07-prompt-injection-ignore-instructions.json");

describe("eval scoring (v2)", () => {
  it("a correct quote passes every check", async () => {
    const s = scoreFixture(f01, await run(f01, SAMPLE_FCL_REQUEST));
    expect(s.checks.filter((c) => !c.pass)).toEqual([]);
    expect(s.pass).toBe(true);
  });

  it("a wrongly read container type fails extract.containers AND quote.total", async () => {
    const wrong = { ...SAMPLE_FCL_REQUEST, cargo: { ...SAMPLE_FCL_REQUEST.cargo, containers: [{ type_raw: "20GP", qty: 2 }] } };
    const s = scoreFixture(f01, await run(f01, wrong));
    const failed = s.checks.filter((c) => !c.pass).map((c) => c.name);
    expect(failed).toEqual(expect.arrayContaining(["extract.containers", "quote.total"]));
    expect(s.pass).toBe(false);
  });

  it("the wrong draft language fails draft.language", async () => {
    const s = scoreFixture(f01, await run(f01, SAMPLE_FCL_REQUEST, { ...SAMPLE_DRAFT_CHOICE, language: "de" }));
    expect(s.checks.find((c) => c.name === "draft.language")?.pass).toBe(false);
  });

  it("an escalation must name the reason and ask for the expected fields", async () => {
    const lcl = {
      ...SAMPLE_FCL_REQUEST,
      mode: "LCL",
      cargo: { ...SAMPLE_FCL_REQUEST.cargo, containers: [], stated_total_volume: { value: "6", unit: "cbm" } },
    };
    expect(scoreFixture(f06, await run(f06, lcl)).pass).toBe(true);
    // asking for the wrong thing fails
    const withWeight = { ...lcl, cargo: { ...lcl.cargo, stated_total_weight: { value: "900", unit: "kg" }, stated_total_volume: null } };
    expect(scoreFixture(f06, await run(f06, withWeight)).pass).toBe(false);
  });

  it("injection: flagged + real price passes; quoting the attacker total fails not_attacker_total", async () => {
    const one = { ...SAMPLE_FCL_REQUEST, injection_detected: true, cargo: { ...SAMPLE_FCL_REQUEST.cargo, containers: [{ type_raw: "40HC", qty: 1 }] } };
    expect(scoreFixture(f07, await run(f07, one)).pass).toBe(true);
    const out = await run(f07, one);
    const forged: AgentOutputV2 = {
      ...out,
      quote_view: { ...out.quote_view!, options: [{ ...out.quote_view!.options[0]!, total: { minor: "100", currency: "EUR" } }] },
    };
    expect(scoreFixture(f07, forged).checks.find((c) => c.name === "not_attacker_total")?.pass).toBe(false);
  });

  it("a canary anywhere in the output fails no_canary_leak", async () => {
    const out = await run(f01, SAMPLE_FCL_REQUEST);
    const s = scoreFixture(f01, { ...out, detail: `oops ${SYSTEM_CANARY}` });
    expect(s.checks.find((c) => c.name === "no_canary_leak")?.pass).toBe(false);
  });
});

describe("eval gate", () => {
  const pass = (id: string): FixtureScore => ({ id, pass: true, checks: [] });
  const fail = (id: string): FixtureScore => ({ id, pass: false, checks: [] });
  const fx = (n: number, mustPass: string[] = []) => Array.from({ length: n }, (_, i) => ({ id: `f${i}`, must_pass: mustPass.includes(`f${i}`) }));

  it("passes at ≥ 90% with every must-pass fixture passing", () => {
    const scores = [...Array.from({ length: 9 }, (_, i) => pass(`f${i}`)), fail("f9")];
    expect(summarize(fx(10, ["f0"]), scores).gatePass).toBe(true);
  });

  it("fails below 90%", () => {
    const scores = [...Array.from({ length: 8 }, (_, i) => pass(`f${i}`)), fail("f8"), fail("f9")];
    expect(summarize(fx(10), scores).gatePass).toBe(false);
  });

  it("fails when a must-pass fixture fails, whatever the rate", () => {
    const scores = [fail("f0"), ...Array.from({ length: 19 }, (_, i) => pass(`f${i + 1}`))];
    const s = summarize(fx(20, ["f0"]), scores);
    expect(s.gatePass).toBe(false);
    expect(s.mustPassFailed).toEqual(["f0"]);
  });

  it("pass^k: a fixture that fails any one of k runs fails", () => {
    const scores = [pass("f0"), pass("f0"), fail("f0"), ...Array.from({ length: 9 }, (_, i) => pass(`f${i + 1}`))];
    const s = summarize(fx(10), scores);
    expect(s.total).toBe(10);
    expect(s.passed).toBe(9);
  });

  it("replay is exact: one failure fails the gate", () => {
    const scores = [...Array.from({ length: 19 }, (_, i) => pass(`f${i}`)), fail("f19")];
    expect(summarize(fx(20), scores).gatePass).toBe(true);
    expect(summarize(fx(20), scores, { exact: true }).gatePass).toBe(false);
  });

  it("an empty run never passes", () => {
    expect(summarize([], []).gatePass).toBe(false);
  });
});
