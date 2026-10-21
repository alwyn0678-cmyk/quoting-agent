import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createLlmFromEnv } from "../packages/agents/src/index.js";
import { runAgentV2 } from "../packages/agents/src/pipeline/run.js";
import { offlineTenant } from "../packages/agents/src/pipeline/tenant.js";
import { scoreFixture, summarize, PASS_RATE, type Fixture, type FixtureScore } from "./score.js";

/**
 * Golden-set eval runner (npm run eval [-- <filter>] [--k N]). Runs the real v2 pipeline against every
 * fixture — each on its own tenant and as-of date — scores it and gates:
 *  - live: pass^k — a fixture passes only if all k runs pass; >= PASS_RATE of fixtures and every
 *    must-pass fixture must pass. Release runs use k >= 3.
 *  - replay (no provider configured): deterministic, so it must pass EXACTLY; a missing recording
 *    (CassetteMissError) aborts the fixture as a failure, never as a model escalation.
 * Each fixture run makes at most two model calls (extraction, draft style).
 */
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { k: { type: "string", default: "1" } } });
  const k = Number(values.k);
  if (!Number.isInteger(k) || k < 1) throw new Error("--k must be a positive integer");
  const only = positionals[0];
  const files = readdirSync(fixturesDir).filter((f) => f.endsWith(".json") && (!only || f.includes(only))).sort();
  const { client, routing, mode } = createLlmFromEnv();
  if (mode === "demo" && k > 1) throw new Error("--k > 1 is meaningless in replay mode (deterministic)");
  console.log(`eval mode=${mode} extract=${routing.extraction} draft=${routing.draft} fixtures=${files.length} k=${k}`);
  const fixtures: Fixture[] = [];
  const scores: FixtureScore[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let cost = 0;

  for (const file of files) {
    let fixture: Fixture | undefined;
    try {
      fixture = JSON.parse(readFileSync(join(fixturesDir, file), "utf8")) as Fixture;
      fixtures.push(fixture);
    } catch (err) {
      scores.push({ id: file, pass: false, checks: [{ name: "parse_fixture", pass: false, detail: `malformed fixture JSON: ${(err as Error).message}` }] });
      console.log(`FAIL  ${file}\n        x malformed fixture JSON`);
      continue;
    }
    for (let run = 1; run <= k; run++) {
      let score: FixtureScore;
      try {
        const { tenant, tariffs } = offlineTenant(fixture.tenant);
        const output = await runAgentV2(fixture.input, { llm: client, routing, tenant, tariffs }, { asOf: fixture.as_of });
        tokensIn += output.usage.input_tokens;
        tokensOut += output.usage.output_tokens;
        cost += output.usage.est_cost_usd ?? 0;
        score = scoreFixture(fixture, output);
      } catch (err) {
        score = { id: fixture.id, pass: false, checks: [{ name: "ran", pass: false, detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err) }] };
      }
      scores.push(score);
      console.log(`${score.pass ? "PASS" : "FAIL"}  ${score.id}${k > 1 ? `  [run ${run}/${k}]` : ""}`);
      for (const c of score.checks.filter((c) => !c.pass)) console.log(`        x ${c.name}${c.detail ? `: ${c.detail}` : ""}`);
    }
  }

  const exact = mode === "demo";
  const summary = summarize(fixtures, scores, { exact });
  console.log(
    `\n${summary.passed}/${summary.total} fixtures pass${k > 1 ? `^${k}` : ""} (gate ${exact ? "100% (replay)" : `>= ${PASS_RATE * 100}%`}; ` +
      `must-pass failures: ${summary.mustPassFailed.length ? summary.mustPassFailed.join(", ") : "none"}) -> ${summary.gatePass ? "GATE PASS" : "GATE FAIL"}`,
  );
  for (const split of ["dev", "holdout"] as const) {
    const ids = new Set(fixtures.filter((f) => (f.split ?? "dev") === split).map((f) => f.id));
    if (ids.size === 0) continue;
    const sub = summarize(fixtures.filter((f) => ids.has(f.id)), scores.filter((s) => ids.has(s.id)), { exact });
    console.log(`  ${split}: ${sub.passed}/${sub.total}`);
  }
  console.log(`[usage] in=${tokensIn} out=${tokensOut} est_cost_usd=${cost.toFixed(4)}${exact ? " (recorded)" : ""}`);
  process.exit(summary.gatePass ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
