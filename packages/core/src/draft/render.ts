import { EQUIPMENT } from "../places/equipment.js";
import { exponentOf, toMajorString, type Money } from "../money/money.js";
import type { ShipmentRequest } from "../request/schema.js";
import type { ChargeLine, PricingResult, RouteOption } from "../pricing/types.js";

/**
 * Draft rendering — every commercial term is written by CODE from the pricing result: options, line
 * amounts, totals, FX note, validity, assumptions and terms. The model contributes only four short
 * prose fields (subject, greeting, intro, closing), which the guard checks for digits, money words,
 * commitments and unknown slots. Number drift in a draft is therefore structurally impossible.
 * Customer-facing text shows SELL amounts only — never per-unit rates (on BUY offers those are costs).
 */

export interface DraftTemplate {
  /** May contain {{ROUTE}}. */
  subject_template: string;
  /** May contain {{GREETING_NAME}}. */
  greeting: string;
  intro: string;
  closing: string;
}

export interface TenantPresentation {
  name: string;
  locale: string;
  signature: string;
  terms_ref: string | null;
}

/** Untrusted/tariff text inserted into a draft: printable, single-line, no slot syntax, length-capped. */
export function safeText(s: string | null | undefined, max = 80): string {
  if (!s) return "";
  return s
    .replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, " ")
    .replace(/\{\{|\}\}/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function formatMoney(m: Money, locale: string): string {
  const exp = exponentOf(m.currency);
  const nf = new Intl.NumberFormat(locale, { minimumFractionDigits: exp, maximumFractionDigits: exp });
  // Intl formats decimal STRINGS exactly (no float conversion).
  return `${m.currency} ${nf.format(toMajorString(m) as unknown as number)}`;
}

function qtyText(l: ChargeLine): string {
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
      return "per shipment";
    case "PER_BL":
      return "per B/L";
    default:
      return "";
  }
}

function optionBlock(o: RouteOption, n: number, locale: string, quoteCurrency: string): string {
  const head = [
    `Option ${n} · ${safeText(o.carrier, 60)}`,
    o.transit_days !== null ? `approx. ${o.transit_days} days transit` : null,
    `valid until ${o.valid_until}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const lines = [...o.legs.flatMap((leg) => leg.lines), ...o.adjustments].map((l) => {
    const label = safeText(l.description, 48);
    const q = qtyText(l);
    return `  - ${label}${q ? ` (${q})` : ""}: ${formatMoney(l.sell, locale)}`;
  });
  const total = `  Total: ${formatMoney(o.totals.quote, locale)}`;
  const fx = o.fx_conversions
    .filter((r) => r.kind === "SELL")
    .map((r) => `  (${r.from} amounts converted to ${quoteCurrency} at ${r.source} rates of ${r.as_of})`);
  return [head, ...lines, total, ...fx].join("\n");
}

export function assumptionLines(req: ShipmentRequest): string[] {
  const out: string[] = [];
  if (req.cargo.dangerous_goods === null || req.cargo.temperature_controlled === null) {
    out.push("Quoted as non-hazardous, non-temperature-controlled general cargo.");
  }
  out.push("Port-to-port service; local charges at origin and destination beyond those listed are not included.");
  return out;
}

export function renderQuoteEmail(args: {
  template: DraftTemplate;
  tenant: TenantPresentation;
  request: ShipmentRequest;
  result: Extract<PricingResult, { kind: "priced" }>;
}): { subject: string; body: string } {
  const { template, tenant, request, result } = args;
  const route = `${safeText(request.origin.raw, 40)} (${request.origin.unlocode}) → ${safeText(request.destination.raw, 40)} (${request.destination.unlocode})`;
  const presented = result.presented.map((id) => result.candidates.find((c) => c.id === id)!);
  const cargoText =
    request.cargo.containers.length > 0
      ? request.cargo.containers.map((c) => `${c.qty} × ${safeText(c.type_raw, 20)}`).join(", ")
      : (() => {
          const q = presented[0]!.legs[0]!.quantities;
          return `${q.weight_tonnes?.toString() ?? "?"} t / ${q.volume_cbm?.toString() ?? "?"} m³ (${q.revenue_tons?.toString() ?? "?"} W/M)`;
        })();
  const summary = [
    `Route: ${route}`,
    `Mode: ${request.mode} · Cargo: ${cargoText}${request.cargo.commodity ? ` · ${safeText(request.cargo.commodity, 60)}` : ""}`,
    request.incoterm || request.ready_date
      ? [request.incoterm ? `Incoterm: ${request.incoterm}` : null, request.ready_date ? `Cargo ready: ${request.ready_date}` : null].filter(Boolean).join(" · ")
      : null,
  ]
    .filter(Boolean)
    .join("\n");
  const options = presented.map((o, i) => optionBlock(o, i + 1, tenant.locale, result.quote_currency)).join("\n\n");
  const notes = [
    ...assumptionLines(request),
    tenant.terms_ref ? `All business is subject to our ${safeText(tenant.terms_ref, 80)}.` : null,
  ]
    .filter(Boolean)
    .map((l) => `• ${l}`)
    .join("\n");
  const greeting = template.greeting.replace("{{GREETING_NAME}}", safeText(request.requester_name, 60) || "there");
  const body = [greeting, template.intro, summary, options, notes, template.closing, tenant.signature].join("\n\n");
  const subject = safeText(template.subject_template.replace("{{ROUTE}}", route), 160);
  return { subject, body };
}
