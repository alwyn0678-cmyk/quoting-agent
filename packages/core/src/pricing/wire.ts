import { Dec } from "../money/dec.js";

/**
 * Canonical wire form: plain JSON with every exact decimal and bigint as a decimal STRING. Used for
 * comparison (guard re-derivation), hashing, canary scanning, logging, persistence and cassettes, so
 * none of them ever see a float or a bigint (which JSON.stringify cannot serialise).
 */
export type Wire = null | boolean | number | string | Wire[] | { [k: string]: Wire };

export function toWire(v: unknown): Wire {
  if (v === null || v === undefined) return null;
  if (v instanceof Dec) return v.toString();
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("non-finite number in wire form");
    return v;
  }
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.map(toWire);
  if (typeof v === "object") {
    const out: { [k: string]: Wire } = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (x !== undefined) out[k] = toWire(x);
    }
    return out;
  }
  throw new Error(`unsupported value in wire form: ${typeof v}`);
}
