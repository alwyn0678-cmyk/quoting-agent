import type { ZodTypeAny } from "zod";

/**
 * The LLM port. The agent depends on this interface only — never on a vendor SDK — so any provider
 * (Anthropic natively; OpenAI, Google, Azure, Bedrock, Ollama, OpenRouter, any OpenAI-compatible
 * server through the AI SDK adapter) can sit behind it, and tests use deterministic doubles.
 *
 * The contract is structured output only: the caller supplies a Zod schema (the single source of
 * truth), each adapter derives the provider's schema format from it, and the caller re-validates
 * `data` with that same schema. No adapter forces a tool call or sends sampling parameters.
 */

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

export interface StructuredCall {
  /** Model ref, "provider/model-id" (e.g. "anthropic/claude-opus-5-5", "ollama/qwen2.5:7b"). */
  model: string;
  system: string;
  userContent: string;
  /** Name of the structured output (also how test doubles route canned responses). */
  toolName: string;
  toolDescription: string;
  /** Zod schema for the output — the adapter converts it; the caller validates against it. */
  schema: ZodTypeAny;
}

export interface StructuredResult {
  /** Raw structured output — the caller validates it against its Zod schema. */
  data: unknown;
  usage: Usage;
  /** The model ref that actually served the call (a server-side fallback may differ). */
  model?: string;
}

export interface LlmClient {
  callStructured(call: StructuredCall): Promise<StructuredResult>;
}

/** The provider declined the request (safety refusal). The pipeline escalates; it never guesses. */
export class LlmRefusalError extends Error {
  constructor(
    message: string,
    readonly category: string | null = null,
  ) {
    super(message);
    this.name = "LlmRefusalError";
  }
}

/** The provider returned output that is truncated, not JSON, or not schema-shaped. */
export class LlmOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmOutputError";
  }
}
