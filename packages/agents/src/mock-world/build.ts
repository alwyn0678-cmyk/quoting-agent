import type { ChargeWire, RateLineWire, TariffWire } from "../../../core/src/tariff/model.js";

/**
 * The mock world (docs/research/mock-world-spec.md): six FICTIONAL forwarders with FCL and LCL BUY
 * tariffs, margin policies and presentation settings, built deterministically from a fixed seed so
 * `npm run mockworld:gen` reproduces the committed files byte for byte (tested).
 *
 * Every rate is a seeded draw inside a documented 2026 market band (USD per 40' unless noted; sources:
 * Drewry WCI 2026-10-15, Xeneta 2026-10-07, published FAK notices, forwarder general tariffs — see the
 * research note). Carriers, companies and people are invented; no real tariff table is copied. All of
 * it is an ASSUMPTION (ASSUMPTIONS.md section I) and is labelled SYNTHETIC in every file.
 */

export const MOCK_WORLD_SEED = 20261021;
export const MOCK_WORLD_AS_OF = "2026-10-21";

/** mulberry32 — tiny, well-known, deterministic PRNG. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFor(...parts: string[]): number {
  let h = MOCK_WORLD_SEED;
  for (const ch of parts.join("|")) h = Math.imul(h ^ ch.charCodeAt(0), 2654435761) >>> 0;
  return h;
}

/** A draw in [lo, hi] rounded to `step`; generated rates are whole-number decimal strings. */
function draw(rnd: () => number, lo: number, hi: number, step = 10): string {
  const steps = Math.floor((hi - lo) / step);
  return String(lo + Math.floor(rnd() * (steps + 1)) * step);
}

interface FclLane {
  origin: string;
  destination: string;
  /** USD per 40' DC band. */
  band: [number, number];
  transit: [number, number];
}

interface LclLane {
  origin: string;
  destination: string;
  /** USD per W/M band. */
  band: [number, number];
  transit: [number, number];
}

interface TenantSpec {
  id: string;
  name: string;
  city: string;
  country: string;
  quote_currency: "EUR" | "USD" | "ZAR" | "BRL";
  locale: string;
  languages: string[];
  terms_ref: string;
  email_domain: string;
  carriers: string[];
  /** Local-charge currency at the tenant's own ports. */
  local_currency: "EUR" | "USD" | "ZAR" | "BRL";
  fcl: FclLane[];
  lcl: LclLane[];
  show_carriers: boolean;
}

const TENANTS: TenantSpec[] = [
  {
    id: "linkport", name: "Linkport Forwarders BV", city: "Rotterdam", country: "NL", quote_currency: "EUR", locale: "nl-NL",
    languages: ["nl", "en", "de"], terms_ref: "Dutch Forwarding Conditions (FENEX-style)", email_domain: "linkport.example",
    carriers: ["Northwind Lines", "Aurora Shipping", "Meridian Container Line"], local_currency: "EUR", show_carriers: true,
    fcl: [
      { origin: "CNSHA", destination: "NLRTM", band: [2800, 4600], transit: [30, 36] },
      { origin: "CNNGB", destination: "NLRTM", band: [2800, 4600], transit: [31, 38] },
      { origin: "SGSIN", destination: "NLRTM", band: [2400, 3800], transit: [24, 29] },
      { origin: "NLRTM", destination: "USNYC", band: [2400, 3300], transit: [9, 13] },
      { origin: "NLRTM", destination: "USSAV", band: [2400, 3300], transit: [12, 16] },
    ],
    lcl: [{ origin: "CNSHA", destination: "NLRTM", band: [60, 150], transit: [34, 40] }],
  },
  {
    id: "elbkai", name: "Elbkai Spedition GmbH", city: "Hamburg", country: "DE", quote_currency: "EUR", locale: "de-DE",
    languages: ["de", "en"], terms_ref: "German Forwarders' Standard Terms (ADSp-style)", email_domain: "elbkai.example",
    carriers: ["Northwind Lines", "Hanse Ocean Carriers"], local_currency: "EUR", show_carriers: false,
    fcl: [
      { origin: "CNSHA", destination: "DEHAM", band: [2800, 4600], transit: [32, 38] },
      { origin: "CNTAO", destination: "DEHAM", band: [2900, 4700], transit: [33, 40] },
      { origin: "DEHAM", destination: "USNYC", band: [2400, 3300], transit: [10, 14] },
    ],
    lcl: [{ origin: "CNSHA", destination: "DEHAM", band: [60, 150], transit: [36, 42] }],
  },
  {
    id: "prairiegate", name: "Prairiegate Freight LLC", city: "Chicago", country: "US", quote_currency: "USD", locale: "en-US",
    languages: ["en", "es"], terms_ref: "Terms and Conditions of Service (NCBFAA-style)", email_domain: "prairiegate.example",
    carriers: ["Pacific Crest Lines", "Aurora Shipping", "Northwind Lines"], local_currency: "USD", show_carriers: true,
    fcl: [
      { origin: "CNSHA", destination: "USLAX", band: [5000, 8500], transit: [14, 18] },
      { origin: "CNSZX", destination: "USLAX", band: [5000, 8500], transit: [15, 19] },
      { origin: "NLRTM", destination: "USNYC", band: [2400, 3300], transit: [9, 13] },
    ],
    lcl: [{ origin: "CNSHA", destination: "USLAX", band: [70, 160], transit: [20, 26] }],
  },
  {
    id: "lumenstrait", name: "Lumenstrait Cargo Pte Ltd", city: "Singapore", country: "SG", quote_currency: "USD", locale: "en-SG",
    languages: ["en", "zh"], terms_ref: "Standard Trading Conditions (SLA-style)", email_domain: "lumenstrait.example",
    carriers: ["Straits Express Line", "Meridian Container Line"], local_currency: "USD", show_carriers: false,
    fcl: [
      { origin: "SGSIN", destination: "NLRTM", band: [2400, 3800], transit: [24, 29] },
      { origin: "CNSHA", destination: "SGSIN", band: [400, 900], transit: [5, 7] },
    ],
    lcl: [{ origin: "SGSIN", destination: "NLRTM", band: [55, 130], transit: [28, 34] }],
  },
  {
    id: "kopjeveld", name: "Kopjeveld Freight (Pty) Ltd", city: "Johannesburg", country: "ZA", quote_currency: "ZAR", locale: "en-ZA",
    languages: ["en"], terms_ref: "Standard Trading Terms (SAAFF-style)", email_domain: "kopjeveld.example",
    carriers: ["Cape Meridian Shipping", "Northwind Lines"], local_currency: "ZAR", show_carriers: true,
    fcl: [
      { origin: "ZADUR", destination: "NLRTM", band: [2000, 3500], transit: [21, 26] },
      { origin: "CNSHA", destination: "ZADUR", band: [1800, 3200], transit: [22, 28] },
    ],
    lcl: [{ origin: "CNSHA", destination: "ZADUR", band: [65, 140], transit: [28, 35] }],
  },
  {
    id: "ventoleste", name: "Ventoleste Logística Internacional Ltda", city: "São Paulo", country: "BR", quote_currency: "BRL", locale: "pt-BR",
    languages: ["pt", "en", "es"], terms_ref: "Condições Gerais de Prestação de Serviços", email_domain: "ventoleste.example",
    carriers: ["Atlântico Sul Lines", "Aurora Shipping"], local_currency: "BRL", show_carriers: false,
    fcl: [
      { origin: "BRSSZ", destination: "NLRTM", band: [2300, 3000], transit: [17, 22] },
      { origin: "BRSSZ", destination: "USNYC", band: [2600, 3600], transit: [14, 19] },
    ],
    lcl: [{ origin: "BRSSZ", destination: "NLRTM", band: [70, 150], transit: [22, 28] }],
  },
];

/** Local charge levels per local currency (THC per box, ISPS per box, DOC per B/L) — 2026 bands. */
const LOCAL: Record<string, { thc: [number, number]; isps: [number, number]; doc: [number, number]; cfs: [number, number] }> = {
  EUR: { thc: [240, 330], isps: [20, 35], doc: [50, 70], cfs: [25, 35] },
  USD: { thc: [260, 360], isps: [20, 35], doc: [55, 75], cfs: [28, 38] },
  ZAR: { thc: [4200, 6000], isps: [350, 600], doc: [900, 1300], cfs: [450, 650] },
  BRL: { thc: [1300, 1800], isps: [110, 190], doc: [280, 380], cfs: [140, 200] },
};

const EQUIPMENT_RATIOS: [string, number][] = [["22G1", 0.72], ["42G1", 1], ["45G1", 1.03]];

function fclLines(t: TenantSpec, lane: FclLane, carrier: string, carrierIdx: number): RateLineWire[] {
  const rnd = prng(seedFor(t.id, "fcl", lane.origin, lane.destination, carrier));
  const base40 = Number(draw(rnd, lane.band[0], lane.band[1], 25));
  const ebs40 = 400; // Emergency bunker surcharge per 40' (2026 Hormuz context; secondary source)
  const loc = LOCAL[t.local_currency]!;
  const thc = draw(rnd, loc.thc[0], loc.thc[1], 5);
  const isps = draw(rnd, loc.isps[0], loc.isps[1], 1);
  const doc = draw(rnd, loc.doc[0], loc.doc[1], 5);
  const transit = lane.transit[0] + Math.floor(rnd() * (lane.transit[1] - lane.transit[0] + 1));
  // One carrier per tenant expires early so the world contains a realistic "rate expired" case.
  const validTo = carrierIdx === 1 && lane === t.fcl[0] ? "2026-11-15" : undefined;
  const offer = `${carrier.toUpperCase().replace(/[^A-Z]+/g, "_").replace(/^_|_$/g, "")}-FAK-Q4`;
  return EQUIPMENT_RATIOS.map(([iso, ratio]) => {
    const of = String(Math.round((base40 * ratio) / 5) * 5);
    const ebs = String(Math.round((ebs40 * (iso === "22G1" ? 0.5 : 1)) / 5) * 5);
    const charges: ChargeWire[] = [
      { id: "OF", code: "OF", description: "Ocean freight", category: "FREIGHT", basis: "PER_CONTAINER", rate: of, currency: "USD" },
      { id: "EBS", code: "EBS", description: "Emergency bunker surcharge", category: "SURCHARGE", basis: "PER_CONTAINER", rate: ebs, currency: "USD" },
      { id: "THC_O", code: "THC_O", description: "Origin terminal handling", category: "LOCAL", basis: "PER_CONTAINER", rate: thc, currency: t.local_currency },
      { id: "ISPS", code: "ISPS", description: "Port security", category: "LOCAL", basis: "PER_CONTAINER", rate: isps, currency: t.local_currency },
      { id: "DOC", code: "DOC", description: "Documentation", category: "DOCUMENT", basis: "PER_BL", rate: doc, currency: t.local_currency },
    ];
    return {
      id: `${t.id}:${lane.origin}-${lane.destination}:${offer}:${iso}`,
      offer_id: offer,
      mode: "FCL" as const,
      carrier,
      origin: { unlocode: lane.origin },
      destination: { unlocode: lane.destination },
      equipment: iso,
      priority: 0,
      ...(validTo ? { valid_to: validTo } : {}),
      transit_days: transit,
      price_kind: "BUY" as const,
      charges,
      source_ref: `${t.id}-fcl-q4.xlsx!${lane.origin}-${lane.destination}!${carrier}!${iso}`,
    };
  });
}

function lclLine(t: TenantSpec, lane: LclLane, carrier: string): RateLineWire {
  const rnd = prng(seedFor(t.id, "lcl", lane.origin, lane.destination, carrier));
  const of = draw(rnd, lane.band[0], lane.band[1], 1);
  const loc = LOCAL[t.local_currency]!;
  const cfs = draw(rnd, loc.cfs[0], loc.cfs[1], 1);
  const doc = draw(rnd, loc.doc[0], loc.doc[1], 5);
  const transit = lane.transit[0] + Math.floor(rnd() * (lane.transit[1] - lane.transit[0] + 1));
  const offer = `${carrier.toUpperCase().replace(/[^A-Z]+/g, "_").replace(/^_|_$/g, "")}-LCL-Q4`;
  return {
    id: `${t.id}:${lane.origin}-${lane.destination}:${offer}`,
    offer_id: offer,
    mode: "LCL",
    carrier,
    origin: { unlocode: lane.origin },
    destination: { unlocode: lane.destination },
    priority: 0,
    transit_days: transit,
    price_kind: "BUY",
    charges: [
      { id: "OF", code: "OF", description: "Ocean freight", category: "FREIGHT", basis: "PER_WM", rate: of, currency: "USD", min: of },
      { id: "CFS", code: "CFS", description: "CFS handling", category: "LOCAL", basis: "PER_WM", rate: cfs, currency: t.local_currency, min: cfs },
      { id: "DOC", code: "DOC", description: "Documentation", category: "DOCUMENT", basis: "PER_BL", rate: doc, currency: t.local_currency },
    ],
    source_ref: `${t.id}-lcl-q4.xlsx!${lane.origin}-${lane.destination}!${carrier}`,
  };
}

export interface MockTenant {
  id: string;
  name: string;
  city: string;
  country: string;
  quote_currency: string;
  locale: string;
  languages: string[];
  terms_ref: string;
  signature: string;
  carrier_labels: Record<string, string>;
  max_options: number;
  quote_validity_days: number;
  margin_rules: {
    id: string;
    match: { mode?: string };
    kind: "MARKUP_ON_BUY" | "GROSS_MARGIN" | "FLAT";
    value: string;
    currency?: string;
    min_margin?: { amount: string; currency: string };
    applies_to: string[] | "ALL";
    priority: number;
  }[];
}

/** Minimum margin per LCL shipment, in each quote currency (INVENTED policy levels). */
const LCL_MIN_MARGIN: Record<string, string> = { EUR: "75", USD: "85", ZAR: "1500", BRL: "450" };

export interface MockWorld {
  readme: string;
  tenants: MockTenant[];
  tariffs: Record<string, TariffWire[]>;
  fx: { base: string; rates: Record<string, string>; source: string; as_of: string };
}

export function buildMockWorld(): MockWorld {
  const tenants: MockTenant[] = [];
  const tariffs: Record<string, TariffWire[]> = {};
  for (const t of TENANTS) {
    const lines: RateLineWire[] = [];
    for (const lane of t.fcl) t.carriers.forEach((c, i) => lines.push(...fclLines(t, lane, c, i)));
    for (const lane of t.lcl) lines.push(lclLine(t, lane, t.carriers[0]!));
    tariffs[t.id] = [
      {
        id: `${t.id}-2026Q4`,
        tenant_id: t.id,
        version: "2026-Q4-v1",
        source: { kind: "mock-world", ref: `examples/mock-world/tariffs/${t.id}.json` },
        valid_from: "2026-10-01",
        valid_to: "2026-12-31",
        port_groups: {},
        lines,
      },
    ];
    tenants.push({
      id: t.id,
      name: t.name,
      city: t.city,
      country: t.country,
      quote_currency: t.quote_currency,
      locale: t.locale,
      languages: t.languages,
      terms_ref: t.terms_ref,
      signature: `${t.name}\nPricing desk · ${t.city}\nquotes@${t.email_domain}`,
      carrier_labels: t.show_carriers ? Object.fromEntries(t.carriers.map((c) => [c, c])) : {},
      max_options: 3,
      quote_validity_days: 14,
      margin_rules: [
        { id: `${t.id}-fcl-default`, match: { mode: "FCL" }, kind: "MARKUP_ON_BUY", value: "0.10", applies_to: ["FREIGHT", "SURCHARGE"], priority: 0 },
        {
          id: `${t.id}-lcl-default`, match: { mode: "LCL" }, kind: "GROSS_MARGIN", value: "0.15", applies_to: "ALL", priority: 0,
          min_margin: { amount: LCL_MIN_MARGIN[t.quote_currency]!, currency: t.quote_currency },
        },
      ],
    });
  }
  return {
    readme:
      "SYNTHETIC DATA — fictional companies, carriers, people and rates generated by packages/agents/src/mock-world/build.ts " +
      `(seed ${MOCK_WORLD_SEED}). Not real tariffs. See NOTICE.md for attributions.`,
    tenants,
    tariffs,
    fx: {
      base: "EUR",
      // ECB euro foreign exchange reference rates, 21 October 2026 (unmodified; information only).
      rates: { EUR: "1", USD: "1.1234", GBP: "0.83825", CNY: "7.4999", SGD: "1.4348", ZAR: "18.393", BRL: "5.6432", HKD: "8.8155", INR: "106.1265" },
      source: "ECB euro foreign exchange reference rates",
      as_of: MOCK_WORLD_AS_OF,
    },
  };
}
