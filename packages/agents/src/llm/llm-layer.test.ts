import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { MockLanguageModelV4 } from "ai/test";
import { parseModelRef } from "./model-ref.js";
import { toStrictJsonSchema } from "./strict-json-schema.js";
import { AnthropicLlmClient, type AnthropicMessagesApi } from "./anthropic.js";
import { AiSdkLlmClient } from "./ai-sdk.js";
import { estimateStepCostUsd } from "./pricing.js";
import { ReplayLlmClient, RecordingLlmClient, CassetteMissError } from "./replay.js";
import { resolveLlmFromEnv } from "./resolve.js";
import { LlmOutputError, LlmRefusalError, type StructuredCall } from "../llm.js";
import { ExtractionWireSchema } from "../pipeline/extraction-wire.js";
import { ShipmentRequestSchema } from "../../../core/src/request/schema.js";

const DraftSchema = z.object({ subject: z.string(), body: z.string() });
import { MockLlmClient } from "../mock-llm.js";

const call = (over: Partial<StructuredCall> = {}): StructuredCall => ({
  model: "anthropic/claude-opus-5-5",
  system: "sys",
  userContent: "user",
  toolName: "submit_draft",
  toolDescription: "Submit a draft",
  schema: DraftSchema,
  ...over,
});

describe("P0.2 model refs — provider/model strings", () => {
  it("parses provider/model", () => {
    expect(parseModelRef("anthropic/claude-opus-5-5")).toEqual({ provider: "anthropic", modelId: "claude-opus-5-5" });
    expect(parseModelRef("ollama/qwen2.5:7b")).toEqual({ provider: "ollama", modelId: "qwen2.5:7b" });
  });
  it("keeps nested slashes in the model id (OpenRouter style)", () => {
    expect(parseModelRef("openrouter/anthropic/claude-sonnet-5-5")).toEqual({
      provider: "openrouter",
      modelId: "anthropic/claude-sonnet-5-5",
    });
  });
  it("infers the provider for well-known bare ids", () => {
    expect(parseModelRef("claude-haiku-5-5").provider).toBe("anthropic");
    expect(parseModelRef("gpt-5.1").provider).toBe("openai");
    expect(parseModelRef("gemini-3-pro").provider).toBe("google");
  });
  it("rejects unknown providers and unresolvable bare ids", () => {
    expect(() => parseModelRef("nope/x")).toThrow(/unknown provider/i);
    expect(() => parseModelRef("mystery-model")).toThrow(/provider\/model/i);
  });
});

describe("P0.2 strict JSON schema — portable structured-output schema", () => {
  const schema = toStrictJsonSchema(ExtractionWireSchema);
  const walk = (node: unknown, visit: (o: Record<string, unknown>) => void) => {
    if (Array.isArray(node)) node.forEach((n) => walk(n, visit));
    else if (node && typeof node === "object") {
      visit(node as Record<string, unknown>);
      Object.values(node).forEach((v) => walk(v, visit));
    }
  };
  it("closes every object (additionalProperties: false) — including the open field_confidence record", () => {
    walk(schema, (o) => {
      if (o.type === "object") expect(o.additionalProperties).toBe(false);
    });
  });
  it("strips keywords providers reject; the client-side Zod parse still enforces them", () => {
    const banned = ["$schema", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "pattern", "minLength", "maxLength"];
    // on the constraint-rich core schema (regexes, bounds), not the flat wire, so the test is not vacuous
    walk(toStrictJsonSchema(ShipmentRequestSchema), (o) => banned.forEach((k) => expect(o).not.toHaveProperty(k)));
  });
});

/** A fake of the beta Messages API that records the request and returns a canned message. */
function fakeMessages(response: Record<string, unknown>) {
  const requests: Record<string, unknown>[] = [];
  const api: AnthropicMessagesApi = {
    create: async (params) => {
      requests.push(params as unknown as Record<string, unknown>);
      return response as never;
    },
  };
  return { api, requests };
}
const okMessage = (text: string, extra: Record<string, unknown> = {}) => ({
  model: "claude-opus-5-5",
  stop_reason: "end_turn",
  content: [
    { type: "thinking", thinking: "", signature: "x" },
    { type: "text", text },
  ],
  usage: { input_tokens: 120, output_tokens: 40 },
  ...extra,
});

describe("P0.2 Anthropic adapter — native structured outputs, no forced tool_choice", () => {
  it("sends output_config.format json_schema and never tools/tool_choice", async () => {
    const { api, requests } = fakeMessages(okMessage('{"subject":"Re: Quote","body":"hi"}'));
    const out = await new AnthropicLlmClient({ messages: api }).callStructured(call());
    const req = requests[0]!;
    expect(req.model).toBe("claude-opus-5-5");
    expect(req).not.toHaveProperty("tools");
    expect(req).not.toHaveProperty("tool_choice");
    expect(req).not.toHaveProperty("temperature");
    expect((req.output_config as { format: { type: string } }).format.type).toBe("json_schema");
    expect(out.data).toEqual({ subject: "Re: Quote", body: "hi" });
    expect(out.usage).toEqual({ input_tokens: 120, output_tokens: 40 });
    expect(out.model).toBe("anthropic/claude-opus-5-5");
  });
  it("server-side fallbacks are OFF by default: an un-evaluated model never answers (invariant 8)", async () => {
    const { api, requests } = fakeMessages(okMessage('{"subject":"s","body":"b"}'));
    await new AnthropicLlmClient({ messages: api }).callStructured(call());
    expect(requests[0]).not.toHaveProperty("fallbacks");
  });
  it("opted in, server-side refusal fallbacks are sent on models that support them", async () => {
    const { api, requests } = fakeMessages(okMessage('{"subject":"s","body":"b"}'));
    await new AnthropicLlmClient({ messages: api, serverFallbacks: true }).callStructured(call());
    expect(requests[0]!.fallbacks).toBe("default");
    expect(requests[0]!.betas).toContain("server-side-fallback-2026-07-01");
  });
  it("does not send fallbacks for models without them (Haiku), even opted in", async () => {
    const { api, requests } = fakeMessages(okMessage('{"subject":"s","body":"b"}', { model: "claude-haiku-5-5" }));
    await new AnthropicLlmClient({ messages: api, serverFallbacks: true }).callStructured(call({ model: "anthropic/claude-haiku-5-5" }));
    expect(requests[0]).not.toHaveProperty("fallbacks");
  });
  it("reports the model that actually served the request (a fallback may answer)", async () => {
    const { api } = fakeMessages(okMessage('{"subject":"s","body":"b"}', { model: "claude-opus-5" }));
    const out = await new AnthropicLlmClient({ messages: api }).callStructured(call());
    expect(out.model).toBe("anthropic/claude-opus-5");
  });
  it("refusal → LlmRefusalError (the pipeline escalates, never guesses)", async () => {
    const { api } = fakeMessages({ ...okMessage(""), stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber" } });
    await expect(new AnthropicLlmClient({ messages: api }).callStructured(call())).rejects.toBeInstanceOf(LlmRefusalError);
  });
  it("truncated or non-JSON output → LlmOutputError", async () => {
    const trunc = fakeMessages({ ...okMessage('{"subject":'), stop_reason: "max_tokens" });
    await expect(new AnthropicLlmClient({ messages: trunc.api }).callStructured(call())).rejects.toBeInstanceOf(LlmOutputError);
    const junk = fakeMessages(okMessage("not json"));
    await expect(new AnthropicLlmClient({ messages: junk.api }).callStructured(call())).rejects.toBeInstanceOf(LlmOutputError);
  });
  it("rejects a non-anthropic model ref", async () => {
    const { api } = fakeMessages(okMessage("{}"));
    await expect(new AnthropicLlmClient({ messages: api }).callStructured(call({ model: "openai/gpt-5.1" }))).rejects.toThrow(/anthropic/);
  });
});

describe("P0.2 AI SDK adapter — any other provider", () => {
  const model = (text: string) =>
    new MockLanguageModelV4({
      provider: "openai.chat",
      modelId: "gpt-5.1",
      doGenerate: {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 90, noCache: 90, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 30, text: 30, reasoning: 0 },
        },
        warnings: [],
      },
    });
  it("returns schema-shaped data and usage", async () => {
    const client = new AiSdkLlmClient(async () => model('{"subject":"Re: Quote","body":"hello"}'));
    const out = await client.callStructured(call({ model: "openai/gpt-5.1" }));
    expect(out.data).toEqual({ subject: "Re: Quote", body: "hello" });
    expect(out.usage).toEqual({ input_tokens: 90, output_tokens: 30 });
    expect(out.model).toBe("openai/gpt-5.1");
  });
  it("output that fails the schema → LlmOutputError", async () => {
    const client = new AiSdkLlmClient(async () => model('{"subject":1}'));
    await expect(client.callStructured(call({ model: "openai/gpt-5.1" }))).rejects.toBeInstanceOf(LlmOutputError);
  });
});

describe("AI SDK adapter × the real extraction contract (architecture review #9)", () => {
  it("sends a strict-mode-portable schema (no unions, every property required) and round-trips a request", async () => {
    const { extractShipmentRequest } = await import("../pipeline/extract.js");
    const { requestToExtractionWire } = await import("../pipeline/extraction-wire.js");
    const { SAMPLE_FCL_REQUEST } = await import("../pipeline/testing.js");
    let sent: unknown;
    const mock = new MockLanguageModelV4({
      provider: "openai.chat",
      modelId: "gpt-5.1",
      doGenerate: async (options) => {
        sent = (options as { responseFormat?: { schema?: unknown } }).responseFormat?.schema;
        return {
          content: [{ type: "text", text: JSON.stringify(requestToExtractionWire(SAMPLE_FCL_REQUEST)) }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: { inputTokens: { total: 900, noCache: 900, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 300, text: 300, reasoning: 0 } },
          warnings: [],
        };
      },
    });
    const out = await extractShipmentRequest({ from: "a@b.example", subject: "s", body: "b" }, new AiSdkLlmClient(async () => mock), "openai/gpt-5.1");
    expect(out.request).toEqual(SAMPLE_FCL_REQUEST);
    let unions = 0;
    let open = 0;
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== "object") return;
      const o = n as Record<string, unknown>;
      if (Array.isArray(o.type) || o.anyOf || o.oneOf) unions += 1;
      if (o.type === "object" && o.properties && Object.keys(o.properties).length !== ((o.required as string[]) ?? []).length) open += 1;
      Object.values(o).forEach(walk);
    };
    expect(sent).toBeDefined();
    walk(sent);
    expect(unions).toBe(0);
    expect(open).toBe(0);
  });
});

describe("P0.2 pricing — honest cost per step", () => {
  it("prices known Claude models from the published table", () => {
    // claude-opus-5-5: $4 / $20 per MTok
    expect(estimateStepCostUsd("anthropic/claude-opus-5-5", { input_tokens: 1_000_000, output_tokens: 100_000 })).toBe(6);
  });
  it("returns null (unknown), never a fake 0, for unpriced models", () => {
    expect(estimateStepCostUsd("ollama/qwen2.5:7b", { input_tokens: 10, output_tokens: 10 })).toBeNull();
  });
});

describe("P0.2 replay — recorded responses for the no-key demo", () => {
  it("records a live call, then replays it without the live client", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-cassettes-"));
    const live = new MockLlmClient({ data: { subject: "s", body: "b" }, usage: { input_tokens: 5, output_tokens: 6 }, model: "anthropic/claude-opus-5-5" });
    await new RecordingLlmClient(live, dir).callStructured(call());
    expect(readdirSync(dir)).toHaveLength(1);
    const replayed = await new ReplayLlmClient(dir).callStructured(call({ model: "demo/replay" }));
    expect(replayed.data).toEqual({ subject: "s", body: "b" });
    expect(replayed.model).toBe("anthropic/claude-opus-5-5");
  });
  it("a request with no recording fails with a clear, actionable error — a harness fault, not a model fault", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-cassettes-"));
    const miss = new ReplayLlmClient(dir).callStructured(call({ userContent: "something new" }));
    await expect(miss).rejects.toThrow(/no recorded response/i);
    await expect(miss).rejects.toBeInstanceOf(CassetteMissError);
    await expect(miss).rejects.not.toBeInstanceOf(LlmOutputError); // never escalates as model_output_invalid
  });
});

describe("P0.2 resolve from env — pick provider, routing and mode", () => {
  it("no provider configured → demo mode (replay), so a fresh clone works with no keys", () => {
    const r = resolveLlmFromEnv({});
    expect(r.mode).toBe("demo");
    expect(r.routing).toEqual({ extraction: "demo/replay", draft: "demo/replay" });
  });
  it("ANTHROPIC_API_KEY → live, defaulting both steps to Claude Opus 5.5", () => {
    const r = resolveLlmFromEnv({ ANTHROPIC_API_KEY: "k" });
    expect(r.mode).toBe("live");
    expect(r.routing).toEqual({ extraction: "anthropic/claude-opus-5-5", draft: "anthropic/claude-opus-5-5" });
  });
  it("QUOTEAGENT_MODEL selects any provider; per-step overrides win", () => {
    const r = resolveLlmFromEnv({ QUOTEAGENT_MODEL: "openai/gpt-5.1", QUOTEAGENT_DRAFT_MODEL: "ollama/qwen2.5:7b", OPENAI_API_KEY: "k" });
    expect(r.routing).toEqual({ extraction: "openai/gpt-5.1", draft: "ollama/qwen2.5:7b" });
  });
  it("a chosen hosted provider without its key fails fast with the variable to set", () => {
    expect(() => resolveLlmFromEnv({ QUOTEAGENT_MODEL: "openai/gpt-5.1" })).toThrow(/OPENAI_API_KEY/);
  });
  it("local providers need no key", () => {
    expect(resolveLlmFromEnv({ QUOTEAGENT_MODEL: "ollama/qwen2.5:7b" }).mode).toBe("live");
  });
  it("Zod stays the single schema source: an inline schema works end to end", async () => {
    const client = new AiSdkLlmClient(async () =>
      new MockLanguageModelV4({
        doGenerate: {
          content: [{ type: "text", text: '{"ok":true}' }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
          warnings: [],
        },
      }),
    );
    const out = await client.callStructured(call({ model: "google/gemini-3-pro", schema: z.object({ ok: z.boolean() }) }));
    expect(out.data).toEqual({ ok: true });
  });
});

describe("Codex review fixes — P0 hardening of the LLM layer", () => {
  it("#1 an open record is not portable: the converter refuses it instead of silently closing it", () => {
    expect(() => toStrictJsonSchema(z.object({ m: z.record(z.string(), z.number()) }))).toThrow(/open record/i);
  });
  it("#1 the extraction schema converts (per-field confidence is a closed list, not a record)", () => {
    expect(() => toStrictJsonSchema(ExtractionWireSchema)).not.toThrow();
  });
  it("#3 Anthropic: any stop reason other than end_turn is rejected", async () => {
    for (const stop_reason of ["pause_turn", "model_context_window_exceeded", "stop_sequence", "tool_use"]) {
      const { api } = fakeMessages({ ...okMessage('{"subject":"s","body":"b"}'), stop_reason });
      await expect(new AnthropicLlmClient({ messages: api }).callStructured(call())).rejects.toBeInstanceOf(LlmOutputError);
    }
  });
  const finishing = (unified: "length" | "content-filter") =>
    new AiSdkLlmClient(async () =>
      new MockLanguageModelV4({
        doGenerate: {
          content: [{ type: "text", text: '{"subject":"s","body":"b"}' }],
          finishReason: { unified, raw: unified },
          usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
          warnings: [],
        },
      }),
    );
  it("#3 AI SDK: a length-limited response is rejected even if it parses", async () => {
    await expect(finishing("length").callStructured(call({ model: "openai/gpt-5.1" }))).rejects.toBeInstanceOf(LlmOutputError);
  });
  it("#3 AI SDK: a content-filtered response is a refusal", async () => {
    await expect(finishing("content-filter").callStructured(call({ model: "openai/gpt-5.1" }))).rejects.toBeInstanceOf(LlmRefusalError);
  });
  it("#2 demo replay cannot be mixed with live models", () => {
    expect(() => resolveLlmFromEnv({ QUOTEAGENT_EXTRACT_MODEL: "demo/replay", QUOTEAGENT_DRAFT_MODEL: "anthropic/claude-opus-5-5", ANTHROPIC_API_KEY: "k" })).toThrow(/demo/i);
  });
  it("#6 the cassette key changes when the output schema changes", async () => {
    const { cassetteKey } = await import("./replay.js");
    const a = cassetteKey(call({ schema: z.object({ a: z.string() }) }));
    const b = cassetteKey(call({ schema: z.object({ a: z.string(), b: z.string() }) }));
    expect(a).not.toBe(b);
  });
});
