import { toWire } from "../pricing/wire.js";
import { price, type PriceInput, type PricingContext } from "../pricing/engine.js";
import type { PricingResult } from "../pricing/types.js";
import type { Tariff } from "../tariff/model.js";
import type { DraftTemplate } from "../draft/render.js";

/**
 * Guard v2 — deterministic, fail-closed checks on everything the model produced or touched:
 *  - price_mismatch: re-run the engine on the same inputs; the canonical wire JSON must be identical.
 *  - template_*: model prose must contain no digits (any script), no money/magnitude words or currency
 *    symbols, no commercial-commitment phrases, only its allowed slots, and stay short.
 *  - canary_leak: the system-prompt canary must not appear anywhere in the output.
 * Residual risk (novel commitment phrasing) is mitigated by the mandatory human approval in P1a.
 */

export type GuardViolation =
  | "price_mismatch"
  | "canary_leak"
  | "template_length"
  | "template_digits"
  | "template_money"
  | "template_commitment"
  | "template_slot";

export const MODEL_FIELD_MAX = 600;

const DIGITS = /[\p{Nd}〇一二三四五六七八九十百千万亿兩两]/u;
const SYMBOLS = /[€$£¥₹₩₽₺₫₪฿%]|R\$/u;
const MONEY_WORDS = [
  "eur", "usd", "gbp", "cny", "rmb", "sgd", "zar", "brl", "hkd", "inr", "jpy", "chf", "aud", "cad",
  "euro", "euros", "dollar", "dollars", "pound", "pounds", "sterling", "cent", "cents", "yuan", "renminbi",
  "rand", "reais", "rupee", "rupees", "yen",
  "thousand", "thousands", "hundred", "hundreds", "million", "millions", "billion", "percent", "percentage", "per cent",
  "duizend", "honderd", "miljoen", "procent", "tausend", "hundert", "millionen", "prozent",
  "cien", "ciento", "cientos", "millón", "millones", "por ciento", "cem", "cento", "milhão", "milhões", "por cento",
];
const COMMITMENT_PHRASES = [
  "free of charge", "for free", "free shipping", "free delivery", "at no cost", "at no extra cost", "no charge", "no extra charge",
  "complimentary", "waive", "waived", "discount", "discounted", "rebate", "guarantee", "guaranteed", "price match", "best price",
  "gratis", "kostenlos", "kostenfrei", "rabatt", "garantie", "garantiert", "korting", "gegarandeerd",
  "gratuit", "remise", "sin costo", "sin coste", "descuento", "garantizado", "desconto", "garantido", "sem custo",
  "免费", "折扣", "保证",
];
const ALLOWED_SLOTS: Record<keyof DraftTemplate, string[]> = {
  subject_template: ["{{ROUTE}}"],
  greeting: ["{{GREETING_NAME}}"],
  intro: [],
  closing: [],
};

const wordRe = (w: string) => new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}])`, "iu");
const MONEY_RES = MONEY_WORDS.map(wordRe);
const COMMIT_RES = COMMITMENT_PHRASES.map((p) => (/[一-鿿]/.test(p) ? new RegExp(p, "u") : wordRe(p)));

export function checkDraftTemplate(t: DraftTemplate): GuardViolation[] {
  const v = new Set<GuardViolation>();
  for (const field of Object.keys(ALLOWED_SLOTS) as (keyof DraftTemplate)[]) {
    const text = t[field] ?? "";
    if (text.length > MODEL_FIELD_MAX) v.add("template_length");
    const withoutSlots = ALLOWED_SLOTS[field].reduce((acc, s) => acc.split(s).join(" "), text);
    if (/\{\{|\}\}/.test(withoutSlots)) v.add("template_slot");
    if (DIGITS.test(withoutSlots)) v.add("template_digits");
    if (SYMBOLS.test(withoutSlots) || MONEY_RES.some((re) => re.test(withoutSlots))) v.add("template_money");
    if (COMMIT_RES.some((re) => re.test(withoutSlots))) v.add("template_commitment");
  }
  return [...v];
}

export function guardPricing(input: PriceInput, tariffs: readonly Tariff[], ctx: PricingContext, result: PricingResult): GuardViolation[] {
  const again = price(input, tariffs, ctx);
  return JSON.stringify(toWire(again)) === JSON.stringify(toWire(result)) ? [] : ["price_mismatch"];
}

export function containsCanary(output: unknown, canary: string): boolean {
  return JSON.stringify(toWire(output)).includes(canary);
}
