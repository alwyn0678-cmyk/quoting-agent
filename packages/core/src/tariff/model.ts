import { createHash } from "node:crypto";
import { z } from "zod";
import { Dec } from "../money/dec.js";
import { CURRENCIES, fromMajor, isCurrency, type Currency, type Money } from "../money/money.js";
import { EQUIPMENT, type IsoType } from "../places/equipment.js";
import type { LaneEnd, PortGroups } from "../places/places.js";
import { IsoDateSchema } from "../time/dates.js";

/**
 * Canonical tariffs. A tariff is an immutable, versioned snapshot of one rate source; it holds rate
 * lines (one carrier offer for one lane end pair and, for FCL, one equipment type) and each line holds
 * charge definitions with an explicit basis. Wire form = JSON with decimal strings; `loadTariff`
 * validates it completely (fail closed, every error named) and returns the in-memory form with exact
 * decimals, money clamps and a content hash over the canonical serialisation.
 */

export const MAX_LINES_PER_TARIFF = 5000;
export const MAX_CHARGES_PER_LINE = 50;
export const MAX_CARRIERS_PER_SNAPSHOT = 20;

export const ChargeBasisSchema = z.enum([
  "PER_CONTAINER", "PER_TEU", "PER_SHIPMENT", "PER_BL", "PER_WM", "PER_CBM", "PER_TON", "PCT_OF",
]);
export const ChargeCategorySchema = z.enum(["FREIGHT", "SURCHARGE", "LOCAL", "DOCUMENT"]);
export const TariffModeSchema = z.enum(["FCL", "LCL", "BARGE", "RAIL"]);
/** Modes priced per container/unit (equipment required on every line). */
export const CONTAINER_MODES = new Set(["FCL", "BARGE", "RAIL"]);

const nonNegDecimal = z.string().max(16).regex(/^\d{1,12}(\.\d{1,8})?$/, "non-negative decimal string (≤ 16 chars)");
const isoDate = IsoDateSchema;
const id = z.string().min(1).max(80).regex(/^[A-Za-z0-9._:-]+$/);
const LaneEndSchema = z.union([
  z.object({ unlocode: z.string().regex(/^[A-Z]{2}[A-Z2-9]{3}$/) }).strict(),
  z.object({ group: id }).strict(),
  z.object({ country: z.string().regex(/^[A-Z]{2}$/) }).strict(),
  z.object({ any: z.literal(true) }).strict(),
]);

export const ChargeWireSchema = z.object({
  id,
  code: z.string().min(1).max(24),
  description: z.string().min(1).max(120),
  category: ChargeCategorySchema,
  basis: ChargeBasisSchema,
  rate: nonNegDecimal,
  currency: z.string().length(3),
  min: nonNegDecimal.optional(),
  max: nonNegDecimal.optional(),
  percent_of: z.array(id).max(20).optional(),
}).strict();

export const RateLineWireSchema = z.object({
  id,
  offer_id: id,
  mode: TariffModeSchema,
  carrier: z.string().min(1).max(80),
  origin: LaneEndSchema,
  destination: LaneEndSchema,
  equipment: z.string().optional(),
  priority: z.number().int().min(-1000).max(1000),
  valid_from: isoDate.optional(),
  valid_to: isoDate.optional(),
  transit_days: z.number().int().min(0).max(365).optional(),
  price_kind: z.enum(["BUY", "SELL"]),
  charges: z.array(ChargeWireSchema).min(1).max(MAX_CHARGES_PER_LINE),
  source_ref: z.string().min(1).max(200),
}).strict();

export const TariffWireSchema = z.object({
  id,
  tenant_id: id,
  version: z.string().min(1).max(60),
  source: z.object({ kind: z.string().min(1).max(40), ref: z.string().min(1).max(200) }).strict(),
  valid_from: isoDate,
  valid_to: isoDate,
  port_groups: z.record(id, z.array(z.string().regex(/^[A-Z]{2}[A-Z2-9]{3}$/)).max(500)),
  lines: z.array(RateLineWireSchema).min(1).max(MAX_LINES_PER_TARIFF),
}).strict();

export type ChargeWire = z.infer<typeof ChargeWireSchema>;
export type RateLineWire = z.infer<typeof RateLineWireSchema>;
export type TariffWire = z.infer<typeof TariffWireSchema>;
export type ChargeBasis = z.infer<typeof ChargeBasisSchema>;
export type ChargeCategory = z.infer<typeof ChargeCategorySchema>;
export type TariffMode = z.infer<typeof TariffModeSchema>;

export interface ChargeDef {
  id: string;
  code: string;
  description: string;
  category: ChargeCategory;
  basis: ChargeBasis;
  rate: Dec;
  currency: Currency;
  min: Money | null;
  max: Money | null;
  percent_of: string[];
  /** Canonical JSON of the wire charge — used for whole-definition equality across composed lines. */
  canonical: string;
}

export interface RateLine {
  id: string;
  offer_id: string;
  mode: TariffMode;
  carrier: string;
  origin: LaneEnd;
  destination: LaneEnd;
  equipment: IsoType | null;
  priority: number;
  valid_from: string;
  valid_to: string;
  transit_days: number | null;
  price_kind: "BUY" | "SELL";
  /** Charges in evaluation order (PCT_OF after everything it references). */
  charges: ChargeDef[];
  source_ref: string;
}

export interface Tariff {
  id: string;
  tenant_id: string;
  version: string;
  source: { kind: string; ref: string };
  valid_from: string;
  valid_to: string;
  port_groups: PortGroups;
  lines: RateLine[];
  content_hash: string;
}

export type LoadResult = { ok: true; tariff: Tariff } | { ok: false; errors: string[] };

/** Canonical decimal spelling ("1000.00" and "001000" → "1000") so semantics, not formatting, hash. */
const canonDec = (s: string | undefined): string | undefined => (s === undefined ? undefined : Dec.parse(s).toString());
const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
function canonicalCharge(c: ChargeWire): Record<string, unknown> {
  return { ...c, rate: canonDec(c.rate), min: canonDec(c.min), max: canonDec(c.max), percent_of: c.percent_of ? [...c.percent_of].sort() : undefined };
}

/** JSON with object keys sorted recursively — the basis of every hash and equality check. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonicalJson(x)}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

const LCL_ONLY = new Set<ChargeBasis>(["PER_WM", "PER_CBM", "PER_TON"]);
/** Charged once per shipment (offer), not per equipment line. */
export const SHIPMENT_LEVEL = new Set<ChargeBasis>(["PER_SHIPMENT", "PER_BL"]);
const FCL_ONLY = new Set<ChargeBasis>(["PER_CONTAINER", "PER_TEU"]);

/** Topologically order charges so every PCT_OF follows what it references; report cycles. */
function orderCharges(lineId: string, charges: ChargeWire[], errors: string[]): ChargeWire[] {
  const byId = new Map(charges.map((c) => [c.id, c]));
  const ordered: ChargeWire[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (c: ChargeWire): void => {
    if (state.get(c.id) === "done") return;
    if (state.get(c.id) === "visiting") {
      errors.push(`line '${lineId}': PCT_OF cycle through charge '${c.id}'`);
      return;
    }
    state.set(c.id, "visiting");
    for (const ref of c.percent_of ?? []) {
      const dep = byId.get(ref);
      if (dep) visit(dep);
    }
    state.set(c.id, "done");
    ordered.push(c);
  };
  for (const c of charges) visit(c);
  return ordered;
}

export function loadTariff(input: unknown): LoadResult {
  const parsed = TariffWireSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
  }
  const w = parsed.data;
  const errors: string[] = [];
  if (w.valid_from > w.valid_to) errors.push(`tariff '${w.id}': valid_from after valid_to`);

  const lineIds = new Set<string>();
  const offerKinds = new Map<string, "BUY" | "SELL">();
  const lines: RateLine[] = [];

  for (const l of w.lines) {
    if (lineIds.has(l.id)) errors.push(`duplicate rate line id '${l.id}'`);
    lineIds.add(l.id);

    const vf = l.valid_from ?? w.valid_from;
    const vt = l.valid_to ?? w.valid_to;
    if (vf > vt) errors.push(`line '${l.id}': valid_from after valid_to`);
    if (vf < w.valid_from || vt > w.valid_to) errors.push(`line '${l.id}': validity outside the tariff's validity`);

    let equipment: IsoType | null = null;
    if (CONTAINER_MODES.has(l.mode)) {
      if (!l.equipment || !(l.equipment in EQUIPMENT)) errors.push(`${l.mode} line '${l.id}' needs a valid ISO 6346 equipment code`);
      else equipment = l.equipment as IsoType;
    } else if (l.equipment !== undefined) {
      errors.push(`LCL line '${l.id}' must not set equipment`);
    }

    const offerKey = `${l.carrier}\u0000${l.offer_id}`;
    const prevKind = offerKinds.get(offerKey);
    if (prevKind && prevKind !== l.price_kind) errors.push(`offer '${l.offer_id}' mixes BUY and SELL lines`);
    offerKinds.set(offerKey, l.price_kind);

    const chargeIds = new Set<string>();
    for (const c of l.charges) {
      if (chargeIds.has(c.id)) errors.push(`line '${l.id}': duplicate charge id '${c.id}'`);
      chargeIds.add(c.id);
    }

    const charges: ChargeDef[] = [];
    for (const c of orderCharges(l.id, l.charges, errors)) {
      if (!isCurrency(c.currency)) {
        errors.push(`line '${l.id}' charge '${c.id}': unsupported currency '${c.currency}'`);
        continue;
      }
      if (l.mode === "LCL" && FCL_ONLY.has(c.basis)) errors.push(`line '${l.id}' charge '${c.id}': ${c.basis} is not valid for LCL`);
      if (CONTAINER_MODES.has(l.mode) && LCL_ONLY.has(c.basis)) errors.push(`line '${l.id}' charge '${c.id}': ${c.basis} is not valid for ${l.mode}`);
      if (c.basis === "PCT_OF") {
        if (!c.percent_of || c.percent_of.length === 0) errors.push(`line '${l.id}' charge '${c.id}': PCT_OF needs percent_of`);
        for (const ref of c.percent_of ?? []) {
          const target = l.charges.find((x) => x.id === ref);
          if (!target) errors.push(`line '${l.id}' charge '${c.id}': unknown charge '${ref}'`);
          else if (target.currency !== c.currency) errors.push(`line '${l.id}' charge '${c.id}': PCT_OF base must be the same currency`);
          else if (SHIPMENT_LEVEL.has(target.basis)) errors.push(`line '${l.id}' charge '${c.id}': PCT_OF may not reference shipment-level charge '${ref}'`);
        }
      } else if (c.percent_of !== undefined) {
        errors.push(`line '${l.id}' charge '${c.id}': percent_of only allowed with PCT_OF`);
      }
      const clamp = (v: string | undefined, label: string): Money | null => {
        if (v === undefined) return null;
        try {
          return fromMajor(v, c.currency as Currency);
        } catch {
          errors.push(`line '${l.id}' charge '${c.id}': ${label} '${v}' exceeds ${c.currency} precision (${CURRENCIES[c.currency as Currency].exponent} dp)`);
          return null;
        }
      };
      const min = clamp(c.min, "min");
      const max = clamp(c.max, "max");
      if (min && max && min.minor > max.minor) errors.push(`line '${l.id}' charge '${c.id}': min > max`);
      charges.push({
        id: c.id,
        code: c.code,
        description: c.description,
        category: c.category,
        basis: c.basis,
        rate: Dec.parse(c.rate),
        currency: c.currency as Currency,
        min,
        max,
        percent_of: c.percent_of ?? [],
        canonical: canonicalJson(canonicalCharge(c)),
      });
    }

    lines.push({
      id: l.id,
      offer_id: l.offer_id,
      mode: l.mode,
      carrier: l.carrier,
      origin: l.origin,
      destination: l.destination,
      equipment,
      priority: l.priority,
      valid_from: vf,
      valid_to: vt,
      transit_days: l.transit_days ?? null,
      price_kind: l.price_kind,
      charges,
      source_ref: l.source_ref,
    });
  }

  for (const [group, members] of Object.entries(w.port_groups)) {
    if (new Set(members).size !== members.length) errors.push(`port group '${group}' has duplicate members`);
  }
  for (const l of w.lines) {
    for (const end of [l.origin, l.destination]) {
      if ("group" in end && !(end.group in w.port_groups)) errors.push(`line '${l.id}': unknown port group '${end.group}'`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // Hash the SEMANTICS: unordered collections sorted, decimals in canonical spelling.
  const { lines: wireLines, port_groups, ...header } = w;
  const canonGroups = Object.fromEntries(Object.entries(port_groups).map(([g, m]) => [g, [...m].sort()]));
  const canonLines = [...wireLines]
    .sort(byId)
    .map((l) => ({ ...l, charges: [...l.charges].sort(byId).map(canonicalCharge) }));
  const content_hash = createHash("sha256")
    .update(canonicalJson({ header: { ...header, port_groups: canonGroups }, lines: canonLines }))
    .digest("hex");

  return {
    ok: true,
    tariff: {
      id: w.id,
      tenant_id: w.tenant_id,
      version: w.version,
      source: w.source,
      valid_from: w.valid_from,
      valid_to: w.valid_to,
      port_groups: w.port_groups,
      lines,
      content_hash,
    },
  };
}

export type SnapshotResult = { ok: true; tariffs: Tariff[] } | { ok: false; errors: string[] };

/**
 * Load every tariff of one tenant's pricing snapshot and validate what only the whole snapshot can
 * show: unique tariff ids, unique rate-line ids across tariffs (receipts and match keys rely on it;
 * charge ids are unique per line, so rate_line_id + charge_id identifies a charge), and the carrier
 * bound.
 */
export function loadSnapshot(inputs: readonly unknown[]): SnapshotResult {
  const errors: string[] = [];
  const tariffs: Tariff[] = [];
  for (const [i, input] of inputs.entries()) {
    const r = loadTariff(input);
    if (r.ok) tariffs.push(r.tariff);
    else errors.push(...r.errors.map((e) => `tariff[${i}]: ${e}`));
  }
  const tariffIds = new Set<string>();
  const lineIds = new Set<string>();
  const carriers = new Set<string>();
  for (const t of tariffs) {
    if (tariffIds.has(t.id)) errors.push(`duplicate tariff id '${t.id}' in snapshot`);
    tariffIds.add(t.id);
    for (const l of t.lines) {
      if (lineIds.has(l.id)) errors.push(`duplicate rate line id '${l.id}' across the snapshot`);
      lineIds.add(l.id);
      carriers.add(l.carrier);
    }
  }
  if (carriers.size > MAX_CARRIERS_PER_SNAPSHOT) {
    errors.push(`snapshot has ${carriers.size} carriers (max ${MAX_CARRIERS_PER_SNAPSHOT})`);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, tariffs };
}
