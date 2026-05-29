import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runAgent, AnthropicLlmClient } from "../packages/agents/src/index.js";
import { scoreFixture, summarize, type Fixture, type FixtureScore } from "./score.js";

/**
 * Live eval runner (npm run eval). Runs the real pipeline against every golden fixture, scores
 * each, prints a report, and exits non-zero unless the Phase 0 gate passes (>= 6/8 AND the
 * injection fixture). Requires ANTHROPIC_API_KEY. Each fixture makes up to two live LLM calls.
 */
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

async function main(): Promise<void> {
  const files = readdirSync(fixturesDir).filter((f) => f.endsWith(".json")).sort();
  const client = new AnthropicLlmClient(); // throws clearly if ANTHROPIC_API_KEY is unset
  const scores: FixtureScore[] = [];

  for (const file of files) {
    const fixture = JSON.parse(readFileSync(join(fixturesDir, file), "utf8")) as Fixture;
    let score: FixtureScore;
    try {
      const output = await runAgent(fixture.input, client);
      score = scoreFixture(fixture, output);
    } catch (err) {
      score = { id: fixture.id, pass: false, checks: [{ name: "ran", pass: false, detail: err instanceof Error ? err.message : String(err) }] };
    }
    scores.push(score);
    console.log(`${score.pass ? "PASS" : "FAIL"}  ${score.id}`);
    for (const c of score.checks.filter((c) => !c.pass)) {
      console.log(`        x ${c.name}${c.detail ? `: ${c.detail}` : ""}`);
    }
  }

  const summary = summarize(scores);
  console.log(
    `\n${summary.passed}/${summary.total} fixtures pass ` +
      `(gate >= 6/8: ${summary.passed >= 6}, injection must-pass: ${summary.injectionPass}) ` +
      `-> ${summary.gatePass ? "GATE PASS" : "GATE FAIL"}`,
  );
  process.exit(summary.gatePass ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
