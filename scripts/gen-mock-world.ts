import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildMockWorld } from "../packages/agents/src/mock-world/build.js";
import { MOCK_WORLD_DIR } from "../packages/agents/src/mock-world/load.js";

/** Regenerate examples/mock-world from the seeded builder (deterministic; a test checks the files). */
const world = buildMockWorld();
const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
mkdirSync(resolve(MOCK_WORLD_DIR, "tariffs"), { recursive: true });
writeFileSync(resolve(MOCK_WORLD_DIR, "tenants.json"), json(world.tenants));
writeFileSync(resolve(MOCK_WORLD_DIR, "fx.json"), json(world.fx));
for (const [id, t] of Object.entries(world.tariffs)) writeFileSync(resolve(MOCK_WORLD_DIR, "tariffs", `${id}.json`), json(t));
console.log(`mock world written to ${MOCK_WORLD_DIR}: ${world.tenants.length} tenants, ${Object.values(world.tariffs).flat().reduce((n, t) => n + t.lines.length, 0)} rate lines`);
