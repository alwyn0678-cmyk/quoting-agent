import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createLlmFromEnv, LINKPORT_TENANT_ID } from "../packages/agents/src/index.js";
import { runAgentV2 } from "../packages/agents/src/pipeline/run.js";
import { legacyTenantConfig } from "../packages/agents/src/pipeline/tenant.js";
import { legacyStaticSource, SupabaseLegacyTariffSource } from "../packages/agents/src/sources/tariff-source.js";
import { createServiceClient } from "../packages/ingest/src/supabase-store.js";
import { gateRequest } from "../packages/core/src/gate/gate.js";
import { price } from "../packages/core/src/pricing/engine.js";
import { toWire } from "../packages/core/src/pricing/wire.js";
import { toMajorString } from "../packages/core/src/money/money.js";
import { goldRequest } from "./expectations.js";
import { scoreFixture, summarize, PASS_RATE, type Fixture, type FixtureScore } from "./score.js";

/**
 * Live integration proof for the production tariff path (npm run eval:adapter). Requires SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY + a live LLM provider.
 *  - Parity: for every legacy golden request, the tariff snapshot read from Supabase (get_rate_card RPC)
 *    prices to a canonical result byte-identical to the static demo card's — same lines, totals, hash.
 *  - Golden set: the legacy fixtures through the v2 pipeline on the Supabase source clear the eval gate.
 */
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

// ── Fixture 05 expectation override (documented drift fix) ──────────────────────────────────────
// Fixture 05 (2 x 40HC, NLRTM -> USLAX) expects out_of_scope_lane, true for the STATIC card. The LIVE
// sheet may hold an active NLRTM-USLAX card (multi-lane import) — then quoting IS correct. When (and
// only when) the live source prices that lane, the expectation becomes a quote at the total DERIVED
// FROM THE ENGINE on the live snapshot (never hand-computed).
const FIXTURE_05_ID = "05-out-of-scope-lane-rotterdam-la";

async function main(): Promise<void> {
  const tenant = legacyTenantConfig(LINKPORT_TENANT_ID);
  const live = new SupabaseLegacyTariffSource(createServiceClient());
  const stat = legacyStaticSource(LINKPORT_TENANT_ID);
  const fixtures = readdirSync(fixturesDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(fixturesDir, f), "utf8")) as Fixture)
    .filter((f) => f.tenant === "legacy");

  // ── Parity: live snapshot vs static card, priced canonically ──
  let parityOk = true;
  for (const f of fixtures.filter((x) => x.expected.decision === "quote")) {
    const gate = gateRequest(goldRequest(f));
    if (!gate.pass) throw new Error(`${f.id}: gold request does not pass the gate`);
    const q = { mode: gate.input.mode, origin: gate.input.origin, destination: gate.input.destination };
    const ctx = tenant.pricing(f.as_of);
    const a = JSON.stringify(toWire(price(gate.input, await live.snapshot(tenant.id, q), ctx)));
    const b = JSON.stringify(toWire(price(gate.input, await stat.snapshot(tenant.id), ctx)));
    console.log(`${a === b ? "PASS" : "FAIL"}  parity  ${f.id}`);
    if (a !== b) parityOk = false;
  }

  // ── Golden set through the v2 pipeline on the live source ──
  const { client, routing, mode } = createLlmFromEnv();
  if (mode === "demo") throw new Error("eval:adapter needs a live LLM provider");
  const scores: FixtureScore[] = [];
  for (let fixture of fixtures) {
    if (fixture.id === FIXTURE_05_ID) {
      const gate = gateRequest(goldRequest(fixture));
      if (gate.pass) {
        const r = price(gate.input, await live.snapshot(tenant.id, { mode: gate.input.mode, origin: gate.input.origin, destination: gate.input.destination }), tenant.pricing(fixture.as_of));
        if (r.kind === "priced") {
          const first = r.candidates.find((c) => c.id === r.presented[0])!;
          const total = toMajorString(first.totals.quote);
          console.log(`NOTE  ${FIXTURE_05_ID}: live sheet prices NLRTM-USLAX -> expecting quote @ ${total} (engine-derived override)`);
          fixture = {
            ...fixture,
            expected: { ...fixture.expected, decision: "quote", escalation_reason: null, quote: { currency: r.quote_currency, total, options: r.presented.length } },
          };
        }
      }
    }
    let score: FixtureScore;
    try {
      const output = await runAgentV2(fixture.input, { llm: client, routing, tenant, tariffs: live }, { asOf: fixture.as_of });
      score = scoreFixture(fixture, output);
    } catch (err) {
      score = { id: fixture.id, pass: false, checks: [{ name: "ran", pass: false, detail: err instanceof Error ? err.message : String(err) }] };
    }
    scores.push(score);
    console.log(`${score.pass ? "PASS" : "FAIL"}  ${score.id}`);
    for (const c of score.checks.filter((c) => !c.pass)) console.log(`        x ${c.name}${c.detail ? `: ${c.detail}` : ""}`);
  }

  const summary = summarize(fixtures, scores);
  const ok = parityOk && summary.gatePass;
  console.log(`\nparity: ${parityOk ? "PASS" : "FAIL"}  |  golden: ${summary.passed}/${summary.total} (gate >= ${PASS_RATE * 100}%) -> ${ok ? "PASS" : "FAIL"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
