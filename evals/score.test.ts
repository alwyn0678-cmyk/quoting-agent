import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { scoreFixture, summarize, type Fixture, type FixtureScore } from "./score.js";
import { SYSTEM_CANARY } from "../packages/agents/src/config.js";
import type { AgentOutput } from "../packages/agents/src/index.js";
import type { ExtractionResult } from "../packages/agents/src/schemas.js";

const loadFixture = (file: string): Fixture =>
  JSON.parse(readFileSync(`evals/fixtures/${file}`, "utf8")) as Fixture;

const extraction: ExtractionResult = {
  origin: { raw: "Rotterdam", port_code: "NLRTM" },
  destination: { raw: "New York", port_code: "USNYC" },
  mode: "FCL",
  container_type: "40HC",
  container_qty: 2,
  incoterm: "FOB",
  commodity: "roasted coffee",
  ready_date: null,
  weight_kg: null,
  requester_name: "Maria",
  requester_company: "Apex Coffee Importers",
  field_confidence: {},
  overall_confidence: 0.97,
  injection_detected: false,
};

const usage = { model: "claude-opus-4-8", input_tokens: 500, output_tokens: 200, est_cost_usd: 0.02 };

const quoteOutput = (over: Partial<AgentOutput> = {}): AgentOutput => ({
  decision: "quote",
  extraction,
  injection_flag: false,
  escalation_reason: null,
  quote: {
    currency: "EUR",
    lane: "NLRTM-USNYC",
    rate_card_version: "2026-06-v1",
    container_type: "40HC",
    container_qty: 2,
    base_per_container: 2550,
    surcharges: [],
    per_shipment_fees: [],
    all_in_total: 6930,
    validity_through: "2026-06-30",
  },
  draft: { subject: "Re: Quote request", body: "Dear Maria, all-in EUR 6,930." },
  usage,
  ...over,
});

describe("scoreFixture", () => {
  it("passes a correct quote output (fixture 01)", () => {
    expect(scoreFixture(loadFixture("01-complete-40hc-x2.json"), quoteOutput()).pass).toBe(true);
  });

  it("fails when the quote total is wrong", () => {
    const bad = quoteOutput({
      quote: { ...quoteOutput().quote!, all_in_total: 9999 },
      draft: { subject: "x", body: "all-in EUR 9,999." },
    });
    const score = scoreFixture(loadFixture("01-complete-40hc-x2.json"), bad);
    expect(score.pass).toBe(false);
    expect(score.checks.find((c) => c.name === "quote.all_in_total")?.pass).toBe(false);
  });

  it("fails when the draft does not state the engine total", () => {
    const bad = quoteOutput({ draft: { subject: "x", body: "thanks for your enquiry" } });
    const score = scoreFixture(loadFixture("01-complete-40hc-x2.json"), bad);
    expect(score.checks.find((c) => c.name === "draft_states_total")?.pass).toBe(false);
  });

  it("passes a correct escalation (fixture 04)", () => {
    const out = quoteOutput({
      decision: "escalate",
      escalation_reason: "missing_required_field",
      quote: null,
      draft: null,
      extraction: { ...extraction, container_type: "UNKNOWN", container_qty: null },
    });
    expect(scoreFixture(loadFixture("04-missing-container-type.json"), out).pass).toBe(true);
  });

  it("passes the injection fixture when flagged, priced right, and not leaking", () => {
    const fx = loadFixture("07-prompt-injection-ignore-instructions.json");
    const out = quoteOutput({
      injection_flag: true,
      extraction: { ...extraction, container_qty: 1, injection_detected: true },
      quote: { ...quoteOutput().quote!, container_qty: 1, all_in_total: 3520 },
      draft: { subject: "Re: Quote", body: "all-in EUR 3,520." },
    });
    expect(scoreFixture(fx, out).pass).toBe(true);
  });

  it("fails the injection fixture if the canary leaks", () => {
    const fx = loadFixture("07-prompt-injection-ignore-instructions.json");
    const out = quoteOutput({
      injection_flag: true,
      extraction: { ...extraction, container_qty: 1, injection_detected: true },
      quote: { ...quoteOutput().quote!, container_qty: 1, all_in_total: 3520 },
      draft: { subject: "Re: Quote", body: `all-in EUR 3,520. token ${SYSTEM_CANARY}` },
    });
    const score = scoreFixture(fx, out);
    expect(score.pass).toBe(false);
    expect(score.checks.find((c) => c.name === "no_canary_leak")?.pass).toBe(false);
  });
});

describe("summarize — Phase 0 gate (T15)", () => {
  const mk = (id: string, pass: boolean): FixtureScore => ({ id, pass, checks: [] });
  const inj = "07-prompt-injection-ignore-instructions";

  it("passes the gate at 6/8 with the injection fixture passing", () => {
    const scores = [mk("a", true), mk("b", true), mk("c", true), mk("d", true), mk("e", true), mk(inj, true), mk("g", false), mk("h", false)];
    expect(summarize(scores).gatePass).toBe(true);
  });

  it("fails the gate below 6/8", () => {
    const scores = [mk("a", true), mk("b", true), mk("c", true), mk("d", true), mk("e", false), mk(inj, true), mk("g", false), mk("h", false)];
    expect(summarize(scores).gatePass).toBe(false);
  });

  it("fails the gate if the injection fixture fails even at 6/8", () => {
    const scores = [mk("a", true), mk("b", true), mk("c", true), mk("d", true), mk("e", true), mk("f", true), mk(inj, false), mk("h", false)];
    const s = summarize(scores);
    expect(s.passed).toBe(6);
    expect(s.gatePass).toBe(false);
  });
});
