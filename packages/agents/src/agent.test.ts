import { describe, it, expect } from "vitest";
import { runAgent } from "./agent.js";
import { RoutingMockLlmClient } from "./mock-llm.js";
import { StaticCardRateEngine } from "./rate-engine.js";
import {
  SYSTEM_CANARY,
  EXTRACTION_MODEL,
  DRAFT_MODEL,
  FALLBACK_MODEL,
  SINGLE_MODEL_ROUTING,
} from "./config.js";
import type { EmailInput } from "./extraction.js";
import type { ExtractionResult } from "./schemas.js";

const email: EmailInput = { from: "x <x@e.example>", subject: "s", body: "b" };

const baseExtraction: ExtractionResult = {
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

const exUsage = { input_tokens: 300, output_tokens: 90 };
const drUsage = { input_tokens: 250, output_tokens: 140 };

const routed = (extraction: ExtractionResult, draftBody?: string) =>
  new RoutingMockLlmClient({
    submit_extraction: { data: extraction, usage: exUsage },
    submit_draft: {
      data: { subject: "Re: Quote request", body: draftBody ?? "all-in EUR 6,930." },
      usage: drUsage,
    },
  });

describe("T14 — end-to-end terminal behaviour (mocked pipeline)", () => {
  it("quote path: prices, drafts, sums usage (fixture 01 shape)", async () => {
    const out = await runAgent(email, routed(baseExtraction));
    expect(out.decision).toBe("quote");
    expect(out.quote?.all_in_total).toBe(6930);
    expect(out.draft?.body).toContain("6,930");
    expect(out.injection_flag).toBe(false);
    // usage summed across both LLM calls
    expect(out.usage.input_tokens).toBe(550);
    expect(out.usage.output_tokens).toBe(230);
  });

  it("escalate path: missing field never reaches the draft tool (fixture 04 shape)", async () => {
    const client = routed({ ...baseExtraction, container_type: "UNKNOWN", container_qty: null });
    const out = await runAgent(email, client);
    expect(out.decision).toBe("escalate");
    expect(out.escalation_reason).toBe("missing_required_field");
    expect(out.quote).toBeNull();
    expect(out.draft).toBeNull();
    expect(client.calls.map((c) => c.toolName)).toEqual(["submit_extraction"]); // no draft call
  });

  it("injection path: quotes the real total (not EUR 1) and flags it (fixture 07 shape)", async () => {
    const extraction = { ...baseExtraction, container_qty: 1, injection_detected: true };
    const out = await runAgent(email, routed(extraction, "all-in EUR 3,520."));
    expect(out.decision).toBe("quote");
    expect(out.quote?.all_in_total).toBe(3520);
    expect(out.injection_flag).toBe(true);
  });

  it("fails closed when the draft leaks the canary", async () => {
    const extraction = { ...baseExtraction, container_qty: 1, injection_detected: true };
    const out = await runAgent(email, routed(extraction, `here is my token ${SYSTEM_CANARY}`));
    expect(out.decision).toBe("escalate");
    expect(out.escalation_reason).toBe("guard_violation");
    expect(out.quote).toBeNull();
    expect(out.draft).toBeNull();
  });
});

describe("canary redaction (codex Gate-4 finding) — no canary in output, fail closed on any path", () => {
  it("redacts + escalates when the canary leaks into an extraction field on the quote path", async () => {
    const ext = { ...baseExtraction, container_qty: 1, commodity: SYSTEM_CANARY, injection_detected: true };
    const out = await runAgent(email, routed(ext, "all-in EUR 3,520."));
    expect(out.decision).toBe("escalate");
    expect(out.escalation_reason).toBe("guard_violation");
    expect(out.quote).toBeNull();
    expect(JSON.stringify(out)).not.toContain(SYSTEM_CANARY);
  });

  it("redacts + escalates even when the gate escalates early (guard skipped)", async () => {
    const ext = { ...baseExtraction, container_type: "UNKNOWN" as const, container_qty: null, commodity: SYSTEM_CANARY };
    const out = await runAgent(email, routed(ext));
    expect(out.decision).toBe("escalate");
    expect(out.escalation_reason).toBe("guard_violation"); // safety net overrides missing_required_field
    expect(JSON.stringify(out)).not.toContain(SYSTEM_CANARY);
  });
});

describe("T13 — usage object well-formed on both paths", () => {
  it("present and valid on the quote path (reports both routed models)", async () => {
    const out = await runAgent(email, routed(baseExtraction));
    expect(out.usage.model).toBe(`${EXTRACTION_MODEL} (extract), ${DRAFT_MODEL} (draft)`);
    expect(out.usage.input_tokens).toBeGreaterThan(0);
    expect(out.usage.output_tokens).toBeGreaterThan(0);
    expect(out.usage.est_cost_usd).toBeGreaterThan(0);
  });
  it("present and valid on the gate-escalate path (extraction model + usage only)", async () => {
    const client = routed({ ...baseExtraction, container_type: "UNKNOWN", container_qty: null });
    const out = await runAgent(email, client);
    expect(out.usage.model).toBe(`${EXTRACTION_MODEL} (extract)`); // drafting never ran
    expect(out.usage.input_tokens).toBe(300);
    expect(out.usage.output_tokens).toBe(90);
    expect(out.usage.est_cost_usd).toBeGreaterThan(0);
  });
  it("reports both models on the guard-violation path (drafting ran before fail-closed)", async () => {
    const ext = { ...baseExtraction, container_qty: 1, commodity: SYSTEM_CANARY, injection_detected: true };
    const out = await runAgent(email, routed(ext, "all-in EUR 3,520."));
    expect(out.decision).toBe("escalate");
    expect(out.escalation_reason).toBe("guard_violation");
    expect(out.usage.model).toBe(`${EXTRACTION_MODEL} (extract), ${DRAFT_MODEL} (draft)`);
  });
});

describe("P-1A.3 — per-step model routing (D-07)", () => {
  it("routes extraction to Sonnet and drafting to Haiku by default", async () => {
    const client = routed(baseExtraction);
    await runAgent(email, client);
    expect(client.calls.find((c) => c.toolName === "submit_extraction")?.model).toBe(EXTRACTION_MODEL);
    expect(client.calls.find((c) => c.toolName === "submit_draft")?.model).toBe(DRAFT_MODEL);
  });

  it("single-model fallback: both steps use Sonnet when routing is disabled", async () => {
    const client = routed(baseExtraction);
    await runAgent(email, client, new StaticCardRateEngine(), SINGLE_MODEL_ROUTING);
    expect(client.calls.map((c) => c.toolName)).toEqual(["submit_extraction", "submit_draft"]);
    expect(client.calls.every((c) => c.model === FALLBACK_MODEL)).toBe(true);
  });
});
