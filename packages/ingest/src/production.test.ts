import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { productionRunDeps } from "./production.js";
import { LINKPORT_TENANT_ID } from "../../agents/src/config.js";
import { pipelineLlm } from "../../agents/src/pipeline/testing.js";

const llm = { client: pipelineLlm(null), routing: { extraction: "anthropic/claude-opus-5-5", draft: "anthropic/claude-opus-5-5" } };
const db = {} as SupabaseClient;

describe("production run deps (security review L1)", () => {
  it("the configured tenant gets its own presentation", () => {
    expect(productionRunDeps(db, LINKPORT_TENANT_ID, llm).tenant.presentation.name).toBe("Linkport Forwarders BV");
  });
  it("an unconfigured tenant is refused, never quoted under another forwarder's name", () => {
    expect(() => productionRunDeps(db, "99999999-9999-4999-8999-999999999999", llm)).toThrow(/no tenant configuration/);
  });
});
