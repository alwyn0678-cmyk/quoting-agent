import type { LanguageModel } from "ai";
import type { ModelRef } from "./model-ref.js";

/**
 * Resolves a non-Anthropic model ref to an AI SDK LanguageModel. OpenAI, Google and the
 * OpenAI-compatible provider (which also serves Ollama, OpenRouter, LM Studio, vLLM, Groq, …) ship
 * with QuoteAgent; Azure and Bedrock are optional installs, loaded only when configured.
 */

export type Env = Record<string, string | undefined>;

async function optionalImport(pkg: string): Promise<Record<string, unknown>> {
  try {
    return (await import(pkg)) as Record<string, unknown>;
  } catch {
    throw new Error(`provider package '${pkg}' is not installed — run: npm install ${pkg}`);
  }
}

export async function resolveAiSdkModel(ref: ModelRef, env: Env): Promise<LanguageModel> {
  const { provider, modelId } = ref;
  switch (provider) {
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      return createOpenAI({ apiKey: env.OPENAI_API_KEY, baseURL: env.OPENAI_BASE_URL })(modelId);
    }
    case "google": {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      return createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY ?? env.GEMINI_API_KEY })(modelId);
    }
    case "ollama":
    case "openrouter":
    case "openai-compatible": {
      const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
      const settings = {
        ollama: { baseURL: env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1", apiKey: undefined },
        openrouter: { baseURL: "https://openrouter.ai/api/v1", apiKey: env.OPENROUTER_API_KEY },
        "openai-compatible": { baseURL: env.OPENAI_COMPATIBLE_BASE_URL, apiKey: env.OPENAI_COMPATIBLE_API_KEY },
      }[provider];
      if (!settings.baseURL) throw new Error("OPENAI_COMPATIBLE_BASE_URL is required for openai-compatible/* models");
      return createOpenAICompatible({
        name: provider,
        baseURL: settings.baseURL,
        apiKey: settings.apiKey,
        supportsStructuredOutputs: true,
      })(modelId);
    }
    case "azure": {
      const mod = await optionalImport("@ai-sdk/azure");
      const createAzure = mod.createAzure as (o: Record<string, unknown>) => (id: string) => LanguageModel;
      return createAzure({ apiKey: env.AZURE_API_KEY, resourceName: env.AZURE_RESOURCE_NAME })(modelId);
    }
    case "bedrock": {
      const mod = await optionalImport("@ai-sdk/amazon-bedrock");
      const createBedrock = mod.createAmazonBedrock as (o: Record<string, unknown>) => (id: string) => LanguageModel;
      return createBedrock({ region: env.AWS_REGION })(modelId);
    }
    case "anthropic":
    case "demo":
      throw new Error(`${provider}/* models are served by a dedicated adapter, not the AI SDK resolver`);
  }
}
