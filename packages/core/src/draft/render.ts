import { z } from "zod";
import { EQUIPMENT } from "../places/equipment.js";
import { portLabel } from "../places/ports.js";
import { exponentOf, toMajorString, type Money } from "../money/money.js";
import type { ShipmentRequest } from "../request/schema.js";
import type { ChargeLine, PricingResult, RouteOption } from "../pricing/types.js";
import { LANGUAGES, chargeKey, phrase, type Language } from "./phrasebook.js";

/**
 * Quote drafts are written ENTIRELY by code (spec §17.6). The model's only drafting output is a closed
 * set of choices — language, formality, intro and closing — so no model free text can state a price,
 * a quantity, a discount or a commitment, by construction rather than by denylist. Every inserted
 * value is canonical (port labels from the UN/LOCODE table, charge names from the phrasebook, numbers
 * from the pricing result) or passes a strict pattern (a requester's plain personal name). Customer
 * text shows SELL amounts only — never per-unit rates, tariff descriptions or carrier names unless the
 * tenant opts in.
 */

export const DraftChoiceSchema = z
  .object({
    language: z.enum(LANGUAGES),
    formality: z.enum(["formal", "informal"]),
    intro: z.enum(["thanks_for_request", "thanks_for_interest", "following_up"]),
    closing: z.enum(["questions_welcome", "look_forward", "book_invite"]),
  })
  .strict();
export type DraftChoice = z.infer<typeof DraftChoiceSchema>;

export interface TenantPresentation {
  name: string;
  /** Number/date formatting locale, e.g. "nl-NL". */
  locale: string;
  /** Tenant-owned, multi-line; sanitised line by line. */
  signature: string;
  /** Name of the tenant's trading conditions, e.g. "Dutch Forwarding Conditions". */
  terms_ref: string | null;
  /** Many forwarders do not disclose the carrier on a quote. */
  show_carrier: boolean;
}

/** One printable line: NFKC-normalised; every control (Cc) and format (Cf) character removed. */
export function sanitizeLine(s: string | null | undefined, max = 120): string {
  if (!s) return "";
  return s
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\{\{|\}\}/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** A plain personal name (letters, spaces, apostrophes, hyphens, periods; ≤ 40) — otherwise null. */
export function safeName(s: string | null | undefined): string | null {
  const t = sanitizeLine(s, 200);
  return /^[\p{L}][\p{L} .'-]{0,39}$/u.test(t) ? t : null;
}

const safeCarrier = (s: string): string | null => {
  const t = sanitizeLine(s, 60);
  return /^[\p{L}][\p{L} .&'-]{0,39}$/u.test(t) ? t : null;
};

export function formatMoney(m: Money, locale: string): string {
  const exp = exponentOf(m.currency);
  const nf = new Intl.NumberFormat(locale, { minimumFractionDigits: exp, maximumFractionDigits: exp });
  // Intl formats decimal STRINGS exactly (no float conversion).
  return `${m.currency} ${nf.format(toMajorString(m) as unknown as number)}`;
}

function formatDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

function qtyText(l: ChargeLine, lang: Language): string {
  const q = l.qty.toString();
  switch (l.basis) {
    case "PER_CONTAINER":
      return l.equipment ? `${q} × ${EQUIPMENT[l.equipment].label}` : q;
    case "PER_TEU":
      return `${q} TEU`;
    case "PER_WM":
      return `${q} W/M`;
    case "PER_CBM":
      return `${q} m³`;
    case "PER_TON":
      return `${q} t`;
    case "PER_SHIPMENT":
      return phrase(lang, "per_shipment");
    case "PER_BL":
      return phrase(lang, "per_bl");
    default:
      return "";
  }
}

function optionBlock(o: RouteOption, n: number, lang: Language, tenant: TenantPresentation, quoteCurrency: string): string {
  const carrier = tenant.show_carrier ? safeCarrier(o.carrier) : null;
  const head = [
    `${phrase(lang, "option")} ${n}${carrier ? ` · ${carrier}` : ""}`,
    o.transit_days !== null ? phrase(lang, "transit", { days: String(o.transit_days) }) : null,
    phrase(lang, "valid_until", { date: formatDate(o.valid_until, tenant.locale) }),
  ]
    .filter(Boolean)
    .join(" · ");
  const lines = [...o.legs.flatMap((leg) => leg.lines), ...o.adjustments].map((l) => {
    const q = qtyText(l, lang);
    return `  - ${phrase(lang, chargeKey(l.code))}${q ? ` (${q})` : ""}: ${formatMoney(l.sell, tenant.locale)}`;
  });
  const total = `  ${phrase(lang, "total")}: ${formatMoney(o.totals.quote, tenant.locale)}`;
  const fx = o.fx_conversions
    .filter((r) => r.kind === "SELL")
    .map(
      (r) =>
        `  (${phrase(lang, "fx_note", {
          from: r.from,
          to: quoteCurrency,
          source: phrase(lang, r.source.toUpperCase().startsWith("ECB") ? "fx_source_ecb" : "fx_source_other"),
          date: formatDate(r.as_of, tenant.locale),
        })})`,
    );
  return [head, ...lines, total, ...fx].join("\n");
}

export function renderQuoteEmail(args: {
  choice: DraftChoice;
  tenant: TenantPresentation;
  request: ShipmentRequest;
  result: Extract<PricingResult, { kind: "priced" }>;
}): { subject: string; body: string } {
  const { choice, tenant, request, result } = args;
  const lang = choice.language;
  const route = `${portLabel(request.origin.unlocode!)} → ${portLabel(request.destination.unlocode!)}`;
  const presented = result.presented.map((id) => result.candidates.find((c) => c.id === id)!);
  const q = presented[0]!.legs[0]!.quantities;
  const cargoText =
    Object.keys(q.containers).length > 0
      ? Object.entries(q.containers)
          .map(([iso, n]) => `${n} × ${EQUIPMENT[iso as keyof typeof EQUIPMENT].label}`)
          .join(", ")
      : `${q.weight_tonnes?.toString()} t / ${q.volume_cbm?.toString()} m³ (${q.revenue_tons?.toString()} W/M)`;

  const name = safeName(request.requester_name);
  const greeting = phrase(lang, `greeting_${choice.formality}${name ? "_named" : ""}`, { name: name ?? "" });
  const summary = [
    `${phrase(lang, "route")}: ${route}`,
    `${phrase(lang, "mode")}: ${request.mode} · ${phrase(lang, "cargo")}: ${cargoText}`,
    [
      request.incoterm ? `${phrase(lang, "incoterm")}: ${request.incoterm}` : null,
      request.ready_date ? `${phrase(lang, "ready")}: ${formatDate(request.ready_date, tenant.locale)}` : null,
    ]
      .filter(Boolean)
      .join(" · ") || null,
  ]
    .filter(Boolean)
    .join("\n");
  const options = presented.map((o, i) => optionBlock(o, i + 1, lang, tenant, result.quote_currency)).join("\n\n");
  const notes = [
    request.cargo.dangerous_goods === null || request.cargo.temperature_controlled === null ? phrase(lang, "assume_general") : null,
    phrase(lang, "assume_port"),
    tenant.terms_ref ? phrase(lang, "terms", { terms: sanitizeLine(tenant.terms_ref, 80) }) : null,
  ]
    .filter(Boolean)
    .map((l) => `• ${l}`)
    .join("\n");
  const signature = tenant.signature
    .split(/\r?\n/)
    .map((l) => sanitizeLine(l, 120))
    .filter(Boolean)
    .slice(0, 8)
    .join("\n");
  const body = [
    greeting,
    phrase(lang, `intro_${choice.intro}`),
    summary,
    options,
    notes,
    phrase(lang, `closing_${choice.closing}`),
    signature,
  ].join("\n\n");
  return { subject: phrase(lang, "subject", { route }), body };
}
