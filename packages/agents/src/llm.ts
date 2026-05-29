import Anthropic from "@anthropic-ai/sdk";

/**
 * Thin LLM abstraction. The agent depends on this interface, not on the SDK directly, so the
 * extraction/draft steps can be unit-tested with a mock (see mock-llm.ts) and exercised live
 * with AnthropicLlmClient. All structured output goes through a single forced tool call.
 */

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

export interface StructuredCall {
  /** The model id this step routes to (D-07) — extraction and drafting may differ. */
  model: string;
  system: string;
  userContent: string;
  toolName: string;
  toolDescription: string;
  /** JSON Schema for the tool input (derived from a Zod schema by the caller). */
  inputSchema: Record<string, unknown>;
}

export interface StructuredResult {
  /** Raw tool input from the model — caller validates it against its Zod schema. */
  data: unknown;
  usage: Usage;
}

export interface LlmClient {
  callStructured(call: StructuredCall): Promise<StructuredResult>;
}

/** Real client. Forces a single tool call against the model the caller routes to per step. */
export class AnthropicLlmClient implements LlmClient {
  private readonly client: Anthropic;

  constructor(apiKey: string = process.env.ANTHROPIC_API_KEY ?? "") {
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set — required for live LLM calls.");
    }
    this.client = new Anthropic({ apiKey });
  }

  async callStructured(call: StructuredCall): Promise<StructuredResult> {
    const message = await this.client.messages.create({
      model: call.model,
      max_tokens: 2048,
      system: call.system,
      messages: [{ role: "user", content: call.userContent }],
      tools: [
        {
          name: call.toolName,
          description: call.toolDescription,
          input_schema: call.inputSchema as unknown as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: call.toolName },
    });

    const block = message.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") {
      throw new Error("model did not return the expected tool_use block");
    }
    return {
      data: block.input,
      usage: {
        input_tokens: message.usage.input_tokens,
        output_tokens: message.usage.output_tokens,
      },
    };
  }
}
