import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import { LlmOutputError, type LlmClient, type StructuredCall, type StructuredResult } from "../llm.js";

/**
 * Record/replay ("cassettes") for the no-key demo and deterministic e2e tests. A cassette is keyed by
 * the request content (output name + output schema + system prompt + user content) — not the model — so a response
 * recorded once from a real model can be replayed by anyone, offline, with no API key. Replayed
 * results keep the model that originally produced them, so the demo never misreports its source.
 */

export interface Cassette {
  key: string;
  toolName: string;
  recorded_at: string;
  model: string | undefined;
  data: unknown;
  usage: StructuredResult["usage"];
  /** First characters of the request, to make cassette files reviewable. */
  request_excerpt: string;
}

/** Keyed by request content AND output schema: a contract change invalidates old recordings. */
export function cassetteKey(call: Pick<StructuredCall, "toolName" | "system" | "userContent" | "schema">): string {
  const schema = JSON.stringify(zodToJsonSchema(call.schema, { $refStrategy: "none" }));
  return createHash("sha256").update(`${call.toolName}\n${schema}\n${call.system}\n${call.userContent}`).digest("hex").slice(0, 24);
}

const fileFor = (dir: string, call: StructuredCall) => join(dir, `${call.toolName}-${cassetteKey(call)}.json`);

export class ReplayLlmClient implements LlmClient {
  constructor(private readonly dir: string) {}

  async callStructured(call: StructuredCall): Promise<StructuredResult> {
    const file = fileFor(this.dir, call);
    if (!existsSync(file)) {
      throw new LlmOutputError(
        `demo mode: no recorded response for this ${call.toolName} request. The demo replays recorded model ` +
          `output for the bundled example emails only — set ANTHROPIC_API_KEY (or QUOTEAGENT_MODEL for another ` +
          `provider) to process new emails.`,
      );
    }
    const cassette = JSON.parse(readFileSync(file, "utf8")) as Cassette;
    return { data: cassette.data, usage: cassette.usage, model: cassette.model };
  }
}

export class RecordingLlmClient implements LlmClient {
  constructor(
    private readonly live: LlmClient,
    private readonly dir: string,
  ) {}

  async callStructured(call: StructuredCall): Promise<StructuredResult> {
    const result = await this.live.callStructured(call);
    mkdirSync(this.dir, { recursive: true });
    const cassette: Cassette = {
      key: cassetteKey(call),
      toolName: call.toolName,
      recorded_at: new Date().toISOString(),
      model: result.model ?? call.model,
      data: result.data,
      usage: result.usage,
      request_excerpt: call.userContent.slice(0, 400),
    };
    writeFileSync(fileFor(this.dir, call), JSON.stringify(cassette, null, 2) + "\n");
    return result;
  }
}
