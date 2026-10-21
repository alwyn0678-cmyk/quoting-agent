import { describe, it, expect } from "vitest";
import { formatAgentOutput } from "./format.js";
import { runAgentV2 } from "../../../packages/agents/src/pipeline/run.js";
import { legacyTenantConfig } from "../../../packages/agents/src/pipeline/tenant.js";
import { legacyStaticSource } from "../../../packages/agents/src/sources/tariff-source.js";
import { pipelineLlm, SAMPLE_FCL_REQUEST } from "../../../packages/agents/src/pipeline/testing.js";
import { LINKPORT_TENANT_ID } from "../../../packages/agents/src/config.js";

const email = { from: "x <x@e.example>", subject: "s", body: "b" };
const run = (request: unknown) =>
  runAgentV2(email, { llm: pipelineLlm(request), tariffs: legacyStaticSource(LINKPORT_TENANT_ID), tenant: legacyTenantConfig() }, { asOf: "2026-06-01" });

describe("terminal rendering (v2)", () => {
  it("quote: prints the draft, one summary line per option, and the usage line", async () => {
    const text = formatAgentOutput(await run(SAMPLE_FCL_REQUEST));
    expect(text).toContain("DRAFT REPLY");
    expect(text).toContain("EUR 6,930.00"); // in the rendered body
    expect(text).toContain("[option 1] FCL Rotterdam (NLRTM) → New York (USNYC) — EUR 6930.00"); // machine line
    expect(text).toContain("[pricing] 1 presented of 1 priced options");
    expect(text).toContain("[usage] model=");
  });

  it("escalate: prints the reason and what to ask for, no draft, and still the usage line", async () => {
    const text = formatAgentOutput(await run({ ...SAMPLE_FCL_REQUEST, cargo: { ...SAMPLE_FCL_REQUEST.cargo, containers: [] } }));
    expect(text).toContain("ESCALATED TO HUMAN");
    expect(text).toContain("missing_required_field");
    expect(text).toContain("Ask the customer for: containers");
    expect(text).not.toContain("DRAFT REPLY");
    expect(text).toContain("[usage]");
  });

  it("injection: prints the flag line alongside the quote", async () => {
    const text = formatAgentOutput(await run({ ...SAMPLE_FCL_REQUEST, injection_detected: true }));
    expect(text).toContain("[flag] prompt-injection detected");
    expect(text).toContain("DRAFT REPLY");
  });
});
