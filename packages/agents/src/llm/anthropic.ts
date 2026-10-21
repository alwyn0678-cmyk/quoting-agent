import Anthropic from "@anthropic-ai/sdk";
import { LlmOutputError, LlmRefusalError, type LlmClient, type StructuredCall, type StructuredResult } from "../llm.js";
import { parseModelRef } from "./model-ref.js";
import { toStrictJsonSchema } from "./strict-json-schema.js";

/**
 * Native Anthropic adapter — the reference path. Uses structured outputs (output_config.format with
 * a JSON schema) instead of a forced tool call: current Claude models reject forced tool_choice, and
 * structured outputs guarantee schema-shaped JSON. No sampling parameters are sent. A refusal or a
 * truncated/non-JSON response throws, and the pipeline fails closed.
 */

/** The slice of the SDK this adapter uses — injectable so the adapter is unit-testable offline. */
export interface AnthropicMessagesApi {
  create(params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming): Promise<Anthropic.Beta.Messages.BetaMessage>;
}

/** Models that accept server-side refusal fallbacks (`fallbacks: "default"`). */
const SERVER_FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);
const SERVER_FALLBACK_BETA = "server-side-fallback-2026-07-01";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AnthropicLlmClientOptions {
  apiKey?: string;
  /** Injected Messages API (tests). Defaults to a real SDK client's beta.messages. */
  messages?: AnthropicMessagesApi;
  /** Optional effort level; omitted means the model's default. */
  effort?: Effort;
  maxTokens?: number;
}

export class AnthropicLlmClient implements LlmClient {
  private readonly messages: AnthropicMessagesApi;
  private readonly effort?: Effort;
  private readonly maxTokens: number;

  constructor(options: AnthropicLlmClientOptions = {}) {
    if (options.messages) {
      this.messages = options.messages;
    } else {
      const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set — required for the anthropic provider.");
      const client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 2 });
      this.messages = { create: (params) => client.beta.messages.create(params) };
    }
    this.effort = options.effort;
    this.maxTokens = options.maxTokens ?? 16_000;
  }

  async callStructured(call: StructuredCall): Promise<StructuredResult> {
    const { provider, modelId } = parseModelRef(call.model);
    if (provider !== "anthropic") {
      throw new Error(`AnthropicLlmClient only serves anthropic/* models, got '${call.model}'`);
    }

    const params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming = {
      model: modelId,
      max_tokens: this.maxTokens,
      system: call.system,
      messages: [{ role: "user", content: call.userContent }],
      output_config: {
        format: { type: "json_schema", schema: toStrictJsonSchema(call.schema) },
        ...(this.effort ? { effort: this.effort } : {}),
      },
      ...(SERVER_FALLBACK_MODELS.has(modelId) ? { fallbacks: "default" as const, betas: [SERVER_FALLBACK_BETA] } : {}),
    };

    const message = await this.messages.create(params);

    if (message.stop_reason === "refusal") {
      const details = (message as { stop_details?: { category?: string | null } }).stop_details;
      throw new LlmRefusalError(`model refused the ${call.toolName} request`, details?.category ?? null);
    }
    if (message.stop_reason !== "end_turn") {
      // Allowlist: only a normal completion is trusted. max_tokens, context-window exhaustion,
      // pause_turn, stop_sequence, tool_use or anything new may carry partial-but-parseable JSON.
      throw new LlmOutputError(`${call.toolName}: incomplete response (stop_reason=${message.stop_reason})`);
    }

    const text = message.content
      .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new LlmOutputError(`${call.toolName}: model output was not valid JSON`);
    }

    return {
      data,
      usage: { input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens },
      model: `anthropic/${message.model}`,
    };
  }
}
