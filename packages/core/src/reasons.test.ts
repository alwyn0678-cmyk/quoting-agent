import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ESCALATION_REASONS } from "./reasons.js";

describe("escalation taxonomy — one source of truth", () => {
  it("the latest database CHECK constraint lists exactly the core reasons", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "../../../supabase/migrations");
    const latest = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .filter((sql) => sql.includes("quote_requests_reason_enum") && sql.includes("add constraint"))
      .pop()!;
    const block = latest.slice(latest.lastIndexOf("quote_requests_reason_enum"));
    const listed = [...block.slice(0, block.indexOf(");")).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect([...listed].sort()).toEqual([...ESCALATION_REASONS].sort());
  });
});
