import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createLlmFromEnv } from "../packages/agents/src/index.js";
import { runAgentV2 } from "../packages/agents/src/pipeline/run.js";
import { offlineTenant } from "../packages/agents/src/pipeline/tenant.js";
import { scoreFixture, summarize, PASS_RATE, type Fixture, type FixtureScore } from "./score.js";

/**
 * Golden-set eval runner (npm run eval). Runs the real v2 pipeline against every fixture — each on its
 * own tenant (the legacy demo card or a mock-world forwarder) and as-of date — scores it, prints a
 * report, and exits non-zero unless the gate passes (>= PASS_RATE of fixtures AND every must-pass
 * fixture). Any configured provider (QUOTEAGENT_MODEL); with none, it replays the recorded cassettes.
 * Each fixture makes at most two model calls (extraction, draft style).
 */
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

async function main(): Promise<void> {
  const only = process.argv[2];
  const files = readdirSync(fixturesDir).filter((f) => f.endsWith(".json") && (!only || f.includes(only))).sort();
  const { client, routing, mode } = createLlmFromEnv();
  console.log(`eval mode=${mode} extract=${routing.extraction} draft=${routing.draft} fixtures=${files.length}`);
  const fixtures: Fixture[] = [];
  const scores: FixtureScore[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let cost = 0;

  for (const file of files) {
    let fixture: Fixture | undefined;
    let score: FixtureScore;
    try {
      // parse INSIDE the try: one malformed fixture scores as a failure instead of aborting the run
      fixture = JSON.parse(readFileSync(join(fixturesDir, file), "utf8")) as Fixture;
      fixtures.push(fixture);
      const { tenant, tariffs } = offlineTenant(fixture.tenant);
      const output = await runAgentV2(fixture.input, { llm: client, routing, tenant, tariffs }, { asOf: fixture.as_of });
      tokensIn += output.usage.input_tokens;
      tokensOut += output.usage.output_tokens;
      cost += output.usage.est_cost_usd ?? 0;
      score = scoreFixture(fixture, output);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      score = fixture
        ? { id: fixture.id, pass: false, checks: [{ name: "ran", pass: false, detail }] }
        : { id: file, pass: false, checks: [{ name: "parse_fixture", pass: false, detail: `malformed fixture JSON: ${detail}` }] };
    }
    scores.push(score);
    console.log(`${score.pass ? "PASS" : "FAIL"}  ${score.id}`);
    for (const c of score.checks.filter((c) => !c.pass)) {
      console.log(`        x ${c.name}${c.detail ? `: ${c.detail}` : ""}`);
    }
  }

  const summary = summarize(fixtures, scores);
  console.log(
    `\n${summary.passed}/${summary.total} fixtures pass (gate >= ${PASS_RATE * 100}%; must-pass failures: ` +
      `${summary.mustPassFailed.length ? summary.mustPassFailed.join(", ") : "none"}) -> ${summary.gatePass ? "GATE PASS" : "GATE FAIL"}`,
  );
  console.log(`[usage] in=${tokensIn} out=${tokensOut} est_cost_usd=${cost.toFixed(4)}${mode === "demo" ? " (recorded)" : ""}`);
  process.exit(summary.gatePass ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
