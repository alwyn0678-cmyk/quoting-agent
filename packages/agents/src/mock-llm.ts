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

/**
 * Multi-call test double: routes a canned response by tool name, so the two-call pipeline
 * (submit_extraction then submit_draft) can be exercised offline. Throws if a tool is called
 * with no canned response — which is itself a useful assertion (e.g. an escalate path must
 * never reach the draft tool).
 */
export class RoutingMockLlmClient implements LlmClient {
  calls: StructuredCall[] = [];

  constructor(private readonly byTool: Record<string, StructuredResult>) {}

  async callStructured(call: StructuredCall): Promise<StructuredResult> {
    this.calls.push(call);
    const response = this.byTool[call.toolName];
    if (!response) throw new Error(`no mock response configured for tool '${call.toolName}'`);
    return response;
  }
}
