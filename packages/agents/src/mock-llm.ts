import type { LlmClient, StructuredCall, StructuredResult } from "./llm.js";

/**
 * Test double for LlmClient. Returns a canned response and records the last call so wiring
 * (prompt assembly, schema parsing, usage propagation, error paths) can be tested offline,
 * deterministically, with no network or API key. Not used by production code.
 */
export class MockLlmClient implements LlmClient {
  lastCall?: StructuredCall;

  constructor(private readonly response: StructuredResult) {}

  async callStructured(call: StructuredCall): Promise<StructuredResult> {
    this.lastCall = call;
    return this.response;
  }
}
