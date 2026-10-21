import { generateText, Output, NoObjectGeneratedError, type LanguageModel } from "ai";
import { LlmOutputError, LlmRefusalError, type LlmClient, type StructuredCall, type StructuredResult } from "../llm.js";
import { parseModelRef, type ModelRef } from "./model-ref.js";

/**
 * Adapter for every non-Anthropic provider, via the Vercel AI SDK's provider spec (OpenAI, Google,
 * Azure, Bedrock, Ollama, OpenRouter, any OpenAI-compatible server). The model is resolved lazily
 * per call, so a deployment only needs the provider packages it actually uses.
 */

export type ModelResolver = (ref: ModelRef) => Promise<LanguageModel>;

export class AiSdkLlmClient implements LlmClient {
  constructor(private readonly resolveModel: ModelResolver) {}

  async callStructured(call: StructuredCall): Promise<StructuredResult> {
    const ref = parseModelRef(call.model);
    const model = await this.resolveModel(ref);
    try {
      const result = await generateText({
        model,
        system: call.system,
        prompt: call.userContent,
        output: Output.object({ schema: call.schema, name: call.toolName, description: call.toolDescription }),
        maxRetries: 2,
      });
      if (result.finishReason === "content-filter") {
        throw new LlmRefusalError(`${call.toolName}: ${ref.provider} content filter stopped the response`);
      }
      if (result.finishReason !== "stop") {
        throw new LlmOutputError(`${call.toolName}: incomplete response (finishReason=${result.finishReason})`);
      }
      return {
        data: result.output,
        usage: {
          input_tokens: result.usage.inputTokens ?? 0,
          output_tokens: result.usage.outputTokens ?? 0,
        },
        model: `${ref.provider}/${result.response?.modelId ?? ref.modelId}`,
      };
    } catch (err) {
      if (NoObjectGeneratedError.isInstance(err)) {
        throw new LlmOutputError(`${call.toolName}: ${ref.provider} returned no schema-valid output (${err.message})`);
      }
      throw err;
    }
  }
}
