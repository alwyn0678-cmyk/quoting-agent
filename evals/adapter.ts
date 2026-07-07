import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runAgent,
  AnthropicLlmClient,
  StaticCardRateEngine,
  createSupabaseRateEngine,
  LINKPORT_TENANT_ID,
  type PriceRequest,
} from "../packages/agents/src/index.js";
import { scoreFixture, summarize, PASS_GATE, type Fixture, type FixtureScore } from "./score.js";

/**
 * 1B.3 live integration proof (npm run eval:adapter). Requires SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY + ANTHROPIC_API_KEY.
 *  - AC-3: the SupabaseTable adapter (reading the seeded Linkport card) returns a RateQuote
 *    IDENTICAL to the StaticCard for the golden requests.
 *  - AC-2: the golden set, run through the production pipeline on the Supabase adapter, still
 *    clears the score gate (PASS_GATE in score.ts; injection must-pass).
 */
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

const goldenRequests: PriceRequest[] = [
  { origin_port_code: "NLRTM", destination_port_code: "USNYC", mode: "FCL", container_type: "40HC", container_qty: 2 },
  { origin_port_code: "NLRTM", destination_port_code: "USNYC", mode: "FCL", container_type: "20GP", container_qty: 1 },
  { origin_port_code: "NLRTM", destination_port_code: "USNYC", mode: "FCL", container_type: "40GP", container_qty: 3 },
  { origin_port_code: "NLRTM", destination_port_code: "USNYC", mode: "FCL", container_type: "40HC", container_qty: 1 },
];

// ── Fixture 05 expectation override (documented drift fix) ──────────────────────────────────────
// Fixture 05 (2 x 40HC, NLRTM -> USLAX) expects escalate/out_of_scope_lane, which is true for the
// STATIC card (single NLRTM-USNYC lane). The LIVE Supabase sheet may hold an ACTIVE NLRTM-USLAX
// card (multi-lane import) — then quoting IS the correct behaviour, and scoring the static
// expectation would mislabel it a FAIL. When (and only when) the live engine can price that lane,
// the fixture's expected block is overridden to decision=quote with the total DERIVED FROM THE
// ENGINE ITSELF (never hand-computed), so the run still asserts a real outcome on all 8 fixtures.
const FIXTURE_05_ID = "05-out-of-scope-lane-rotterdam-la";
const FIXTURE_05_REQUEST: PriceRequest = { origin_port_code: "NLRTM", destination_port_code: "USLAX", mode: "FCL", container_type: "40HC", container_qty: 2 };

async function main(): Promise<void> {
  const supa = createSupabaseRateEngine(LINKPORT_TENANT_ID);
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
  // Live-sheet probe for the fixture-05 override (see the block comment above).
  const uslaxCard = await supa.cardFor(FIXTURE_05_REQUEST);
  const uslaxQuote = uslaxCard ? await supa.price(FIXTURE_05_REQUEST, uslaxCard) : null;

  const client = new AnthropicLlmClient();
  const files = readdirSync(fixturesDir).filter((f) => f.endsWith(".json")).sort();
  const scores: FixtureScore[] = [];
  for (const file of files) {
    let fixture = JSON.parse(readFileSync(join(fixturesDir, file), "utf8")) as Fixture;
    if (fixture.id === FIXTURE_05_ID && uslaxQuote) {
      console.log(`NOTE  ${FIXTURE_05_ID}: live sheet has an active NLRTM-USLAX card -> expecting quote @ ${uslaxQuote.all_in_total} (engine-derived override)`);
      fixture = {
        ...fixture,
        expected: { ...fixture.expected, decision: "quote", escalation_reason: null, quote: { all_in_total: uslaxQuote.all_in_total } },
      };
    }
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
      `(gate >= ${PASS_GATE}/${summary.total}: ${summary.passed >= PASS_GATE}, injection must-pass: ${summary.injectionPass}) ` +
      `-> ${ac3ok && summary.gatePass ? "1B.3 PASS" : "1B.3 FAIL"}`,
  );
  process.exit(ac3ok && summary.gatePass ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
