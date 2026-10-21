import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { derive, isDerivable } from "../evals/expectations.js";
import type { Fixture } from "../evals/score.js";

/**
 * npm run eval:derive — writes engine-derived quote expectations (currency, first-option total, option
 * count) into every golden fixture whose gold request is derivable, and reports pricing-stage
 * escalations that disagree. Run after changing tariffs, the mock world or the engine; review the diff.
 */
const dir = "evals/fixtures";
let changed = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const path = join(dir, file);
  const f = JSON.parse(readFileSync(path, "utf8")) as Fixture;
  if (!isDerivable(f)) continue;
  const d = await derive(f);
  if (f.expected.decision === "quote") {
    if (d.decision !== "quote") {
      console.error(`ERROR ${f.id}: gold request does not price (${d.escalation_reason})`);
      process.exitCode = 1;
      continue;
    }
    if (JSON.stringify(f.expected.quote) !== JSON.stringify(d.quote)) {
      f.expected.quote = d.quote;
      writeFileSync(path, `${JSON.stringify(f, null, 2)}\n`);
      changed += 1;
      console.log(`wrote ${f.id}: ${d.quote.currency} ${d.quote.total} (${d.quote.options} options)`);
    }
  } else if (d.decision !== "escalate" || d.escalation_reason !== f.expected.escalation_reason) {
    console.error(`ERROR ${f.id}: expected ${f.expected.escalation_reason}, derivation gives ${JSON.stringify(d)}`);
    process.exitCode = 1;
  }
}
console.log(`${changed} fixture(s) updated`);
