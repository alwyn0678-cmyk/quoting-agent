import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * Converts a Zod schema to the portable subset of JSON Schema that strict structured-output modes
 * accept (Anthropic output_config.format, OpenAI strict json_schema):
 *   - every object is closed (additionalProperties: false); an open record becomes an empty closed
 *     object, so the model returns {} for it;
 *   - numeric/string/array constraints and regex patterns are removed — providers reject them —
 *     and are still enforced, because the caller re-validates the output with the original Zod schema.
 */

const STRIPPED_KEYWORDS = [
  "$schema",
  "default",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
  "propertyNames",
];

function strictify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictify);
  if (!node || typeof node !== "object") return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (STRIPPED_KEYWORDS.includes(key)) continue;
    out[key] = strictify(value);
  }
  const isObject = out.type === "object" || (Array.isArray(out.type) && out.type.includes("object"));
  if (isObject) {
    out.properties = out.properties ?? {};
    out.additionalProperties = false;
    if (out.required === undefined) out.required = [];
  }
  return out;
}

export function toStrictJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  const raw = zodToJsonSchema(schema, { $refStrategy: "none", target: "jsonSchema7" });
  return strictify(raw) as Record<string, unknown>;
}
