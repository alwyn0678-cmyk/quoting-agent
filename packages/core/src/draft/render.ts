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
 * a quantity, a discount or a commitment, by construction rather than by denylist.
 * Inserted values are: canonical (UN/LOCODE port labels, phrasebook charge names, engine numbers),
 * TRUSTED tenant configuration (signature, terms name, carrier label registry — admin-authored), or a
 * TRUSTED contact name supplied by the caller from customer records (never email text; P3). Customer
 * text shows sell amounts per charge line and totals — never BUY costs, raw per-unit rate fields,
 * tariff descriptions or tariff carrier strings.
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

/** Locales supported for number/date formatting (Gregorian calendar, Latin digits are forced). */
export const SUPPORTED_LOCALES = ["en-GB", "en-US", "nl-NL", "de-DE", "es-ES", "pt-BR", "pt-PT", "zh-CN", "en-SG", "en-ZA"] as const;

export interface TenantPresentation {
  name: string;
  /** Number/date formatting locale — must be one of SUPPORTED_LOCALES. */
  locale: string;
  /** Trusted, admin-authored; multi-line; sanitised line by line. */
  signature: string;
  /** Trusted, admin-authored name of the tenant's trading conditions. */
  terms_ref: string | null;
  /** Trusted registry: tariff carrier key → display label. Carriers not listed are not named. */
  carrier_labels: Readonly<Record<string, string>>;
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

const intlLocale = (locale: string): string => {
  if (!(SUPPORTED_LOCALES as readonly string[]).includes(locale)) throw new Error(`unsupported locale '${locale}'`);
  return `${locale}-u-ca-gregory-nu-latn`;
};

export function formatMoney(m: Money, locale: string): string {
  const exp = exponentOf(m.currency);
  const nf = new Intl.NumberFormat(intlLocale(locale), { minimumFractionDigits: exp, maximumFractionDigits: exp });
  // Intl formats decimal STRINGS exactly (no float conversion).
  return `${m.currency} ${nf.format(toMajorString(m) as unknown as number)}`;
}

function formatDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
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
  const label = tenant.carrier_labels[o.carrier];
  const carrier = label ? sanitizeLine(label, 40) : null;
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
  /** A contact name from trusted customer records — never text taken from the email. */
  trusted_name?: string | null;
}): { subject: string; body: string } {
  const choice = DraftChoiceSchema.parse(args.choice);
  const { tenant, request, result } = args;
  intlLocale(tenant.locale);
  const lang = choice.language;
  if (!request.origin.unlocode || !request.destination.unlocode) throw new Error("render: origin/destination unresolved");
  const route = `${portLabel(request.origin.unlocode)} → ${portLabel(request.destination.unlocode)}`;
  const presented = result.presented.map((id) => result.candidates.find((c) => c.id === id));
  if (presented.length === 0 || presented.some((o) => !o || o.legs.length === 0)) {
    throw new Error("render: presented options are missing or malformed");
  }
  const options0 = presented as RouteOption[];
  const q = options0[0]!.legs[0]!.quantities;
  let cargoText: string;
  if (Object.keys(q.containers).length > 0) {
    cargoText = Object.entries(q.containers)
      .map(([iso, n]) => {
        const eq = EQUIPMENT[iso as keyof typeof EQUIPMENT];
        if (!eq) throw new Error(`render: unknown equipment '${iso}'`);
        return `${n} × ${eq.label}`;
      })
      .join(", ");
  } else {
    if (!q.weight_tonnes || !q.volume_cbm || !q.revenue_tons) throw new Error("render: LCL quantities missing");
    cargoText = `${q.weight_tonnes.toString()} t / ${q.volume_cbm.toString()} m³ (${q.revenue_tons.toString()} W/M)`;
  }

  const name = safeName(args.trusted_name ?? null);
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
  const options = options0.map((o, i) => optionBlock(o, i + 1, lang, tenant, result.quote_currency)).join("\n\n");
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
