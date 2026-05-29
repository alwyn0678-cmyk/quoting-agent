import { describe, it, expect } from "vitest";
import { formatAgentOutput } from "./format.js";
import { runAgent, EXTRACTION_MODEL } from "../../../packages/agents/src/index.js";
import { RoutingMockLlmClient } from "../../../packages/agents/src/mock-llm.js";
import type { EmailInput } from "../../../packages/agents/src/index.js";
import type { ExtractionResult } from "../../../packages/agents/src/schemas.js";

const email: EmailInput = { from: "x <x@e.example>", subject: "s", body: "b" };

const extraction: ExtractionResult = {
  origin: { raw: "Rotterdam", port_code: "NLRTM" },
  destination: { raw: "New York", port_code: "USNYC" },
  mode: "FCL",
  container_type: "40HC",
  container_qty: 2,
  incoterm: "FOB",
  commodity: "coffee",
  ready_date: null,
  weight_kg: null,
  requester_name: "Maria",
  requester_company: "Apex",
  field_confidence: {},
  overall_confidence: 0.95,
  injection_detected: false,
};

const client = (x: ExtractionResult) =>
  new RoutingMockLlmClient({
    submit_extraction: { data: x, usage: { input_tokens: 300, output_tokens: 90 } },
    submit_draft: {
      data: { subject: "Re: Quote", body: "Dear Maria, all-in EUR 6,930." },
      usage: { input_tokens: 250, output_tokens: 140 },
    },
  });

describe("T14 — terminal rendering", () => {
  it("quote: prints the draft, the quote summary, and the usage line", async () => {
    const out = await runAgent(email, client(extraction));
    const text = formatAgentOutput(out);
    expect(text).toContain("DRAFT REPLY");
    expect(text).toContain("6,930"); // in the draft body
    expect(text).toContain("all-in EUR 6930"); // machine summary line
    expect(text).toContain(`[usage] model=${EXTRACTION_MODEL}`);
  });

  it("escalate: prints the reason, no draft, and still the usage line", async () => {
    const out = await runAgent(email, client({ ...extraction, container_type: "UNKNOWN", container_qty: null }));
    const text = formatAgentOutput(out);
    expect(text).toContain("ESCALATED TO HUMAN");
    expect(text).toContain("missing_required_field");
    expect(text).not.toContain("DRAFT REPLY");
    expect(text).toContain("[usage]");
  });

  it("injection: prints the flag line alongside the quote", async () => {
    const out = await runAgent(email, client({ ...extraction, injection_detected: true }));
    const text = formatAgentOutput(out);
    expect(text).toContain("[flag] prompt-injection detected");
    expect(text).toContain("DRAFT REPLY");
  });
});
