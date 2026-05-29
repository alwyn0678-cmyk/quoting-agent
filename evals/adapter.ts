import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runAgent,
  AnthropicLlmClient,
  StaticCardRateEngine,
  createSupabaseRateEngine,
  LINKPORT_TENANT_ID,
  DEFAULT_LANE,
  type PriceRequest,
} from "../packages/agents/src/index.js";
import { scoreFixture, summarize, type Fixture, type FixtureScore } from "./score.js";

/**
 * 1B.3 live integration proof (npm run eval:adapter). Requires SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY + ANTHROPIC_API_KEY.
 *  - AC-3: the SupabaseTable adapter (reading the seeded Linkport card) returns a RateQuote
 *    IDENTICAL to the StaticCard for the golden requests.
 *  - AC-2: the golden set, run through the production pipeline on the Supabase adapter, still
 *    scores >= 6/8 (injection must-pass).
 */
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

const goldenRequests: PriceRequest[] = [
  { origin_port_code: "NLRTM", destination_port_code: "USNYC", mode: "FCL", container_type: "40HC", container_qty: 2 },
  { origin_port_code: "NLRTM", destination_port_code: "USNYC", mode: "FCL", container_type: "20GP", container_qty: 1 },
  { origin_port_code: "NLRTM", destination_port_code: "USNYC", mode: "FCL", container_type: "40GP", container_qty: 3 },
  { origin_port_code: "NLRTM", destination_port_code: "USNYC", mode: "FCL", container_type: "40HC", container_qty: 1 },
];

async function main(): Promise<void> {
  const supa = createSupabaseRateEngine(LINKPORT_TENANT_ID, DEFAULT_LANE);
  const stat = new StaticCardRateEngine();

  // ── AC-3: adapter parity vs StaticCard (deterministic; live DB read) ──
  let ac3ok = true;
  for (const req of goldenRequests) {
    const fromDb = await supa.price(req);
    const fromStatic = await stat.price(req);
    const same = JSON.stringify(fromDb) === JSON.stringify(fromStatic);
    console.log(`${same ? "PASS" : "FAIL"}  AC-3 parity  ${req.container_qty} x ${req.container_type} (all_in ${fromDb.all_in_total})`);
    if (!same) {
      ac3ok = false;
      console.log(`        static: ${JSON.stringify(fromStatic)}`);
      console.log(`        supa:   ${JSON.stringify(fromDb)}`);
    }
  }

  // ── AC-2: golden set through the production pipeline on the Supabase adapter ──
  const client = new AnthropicLlmClient();
  const files = readdirSync(fixturesDir).filter((f) => f.endsWith(".json")).sort();
  const scores: FixtureScore[] = [];
  for (const file of files) {
    const fixture = JSON.parse(readFileSync(join(fixturesDir, file), "utf8")) as Fixture;
    let score: FixtureScore;
    try {
      const output = await runAgent(fixture.input, client, supa);
      score = scoreFixture(fixture, output);
    } catch (err) {
      score = { id: fixture.id, pass: false, checks: [{ name: "ran", pass: false, detail: err instanceof Error ? err.message : String(err) }] };
    }
    scores.push(score);
    console.log(`${score.pass ? "PASS" : "FAIL"}  ${score.id}`);
    for (const c of score.checks.filter((c) => !c.pass)) console.log(`        x ${c.name}${c.detail ? `: ${c.detail}` : ""}`);
  }

  const summary = summarize(scores);
  console.log(
    `\nAC-3 parity: ${ac3ok ? "PASS" : "FAIL"}  |  AC-2: ${summary.passed}/${summary.total} ` +
      `(gate >= 6/8: ${summary.passed >= 6}, injection must-pass: ${summary.injectionPass}) ` +
      `-> ${ac3ok && summary.gatePass ? "1B.3 PASS" : "1B.3 FAIL"}`,
  );
  process.exit(ac3ok && summary.gatePass ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
