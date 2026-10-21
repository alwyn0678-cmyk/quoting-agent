import { z } from "zod";
import {
  IncotermSchema,
  LengthUnit,
  RequestFieldSchema,
  RequestModeSchema,
  ServiceSchema,
  VolumeUnit,
  WeightUnit,
  type ShipmentRequest,
} from "../../../core/src/request/schema.js";

/**
 * The provider-facing (wire) form of ShipmentRequest — an anti-corruption layer between the model and
 * the core contract. Strict structured-output modes compile the schema into a grammar with hard limits
 * (Anthropic: ≤ 16 union-typed parameters, ≤ 24 optional parameters, plus an internal grammar-size cap
 * that nesting and optional fields inflate). So the wire is FLAT, has NO unions and NO optional fields:
 *   - absent text/code/date → ""; tri-state flags → "yes" | "no" | "unknown"; an unstated container
 *     count → qty 0 (dropped in code, so the gate asks for it);
 *   - each measurement is two flat fields (value as a decimal string, "" if absent; unit);
 *   - piece dimensions are flat with one dimension unit.
 * fromWire maps it to ShipmentRequest; the core ShipmentRequestSchema then validates everything
 * (regexes, decimal strings, limits) — the wire schema carries structure only.
 */

const TriState = z.enum(["yes", "no", "unknown"]);

const WirePlace = z
  .object({ raw: z.string(), unlocode: z.string(), iata: z.string(), country: z.string(), postcode: z.string() })
  .strict();

const WirePiece = z
  .object({
    qty: z.number().int(),
    length: z.string(),
    width: z.string(),
    height: z.string(),
    dimension_unit: LengthUnit,
    weight_each: z.string(),
    weight_unit: WeightUnit,
    stackable: TriState,
  })
  .strict();

export const ExtractionWireSchema = z
  .object({
    mode: RequestModeSchema,
    service: ServiceSchema,
    origin: WirePlace,
    destination: WirePlace,
    containers: z.array(z.object({ type_raw: z.string(), qty: z.number().int() }).strict()),
    pieces: z.array(WirePiece),
    total_weight: z.string(),
    total_weight_unit: WeightUnit,
    total_volume: z.string(),
    total_volume_unit: VolumeUnit,
    commodity: z.string(),
    dangerous_goods: TriState,
    temperature_controlled: TriState,
    incoterm: z.enum([...IncotermSchema.options, "NONE"]),
    ready_date: z.string(),
    requester_name: z.string(),
    requester_company: z.string(),
    field_confidence: z.array(z.object({ field: RequestFieldSchema, confidence: z.number() }).strict()),
    overall_confidence: z.number(),
    injection_detected: z.boolean(),
    missing_notes: z.array(z.string()),
    conflicting_notes: z.array(z.string()),
  })
  .strict();
export type ExtractionWire = z.infer<typeof ExtractionWireSchema>;

const text = (s: string): string | null => (s.trim() === "" ? null : s.trim());
const tri = (t: z.infer<typeof TriState>): boolean | null => (t === "unknown" ? null : t === "yes");
const fromTri = (b: boolean | null): z.infer<typeof TriState> => (b === null ? "unknown" : b ? "yes" : "no");

/** Wire → ShipmentRequest shape (unvalidated: the caller parses it with ShipmentRequestSchema). */
export function fromWire(w: ExtractionWire): unknown {
  const place = (p: ExtractionWire["origin"]) => ({
    raw: p.raw,
    unlocode: text(p.unlocode)?.toUpperCase() ?? null,
    iata: text(p.iata)?.toUpperCase() ?? null,
    country: text(p.country)?.toUpperCase() ?? null,
    postcode: text(p.postcode),
  });
  return {
    mode: w.mode,
    service: w.service,
    origin: place(w.origin),
    destination: place(w.destination),
    cargo: {
      // qty 0 = "count not stated": the line carries no priceable quantity, so it is dropped and the
      // gate asks for the containers (missing_required_field) instead of failing the schema.
      containers: w.containers.filter((c) => c.qty !== 0),
      pieces: w.pieces.map((p) => ({
        qty: p.qty,
        length: { value: p.length, unit: p.dimension_unit },
        width: { value: p.width, unit: p.dimension_unit },
        height: { value: p.height, unit: p.dimension_unit },
        weight_each: text(p.weight_each) === null ? null : { value: p.weight_each.trim(), unit: p.weight_unit },
        stackable: tri(p.stackable),
      })),
      stated_total_weight: text(w.total_weight) === null ? null : { value: w.total_weight.trim(), unit: w.total_weight_unit },
      stated_total_volume: text(w.total_volume) === null ? null : { value: w.total_volume.trim(), unit: w.total_volume_unit },
      commodity: text(w.commodity),
      dangerous_goods: tri(w.dangerous_goods),
      temperature_controlled: tri(w.temperature_controlled),
    },
    incoterm: w.incoterm === "NONE" ? null : w.incoterm,
    ready_date: text(w.ready_date),
    requester_name: text(w.requester_name),
    requester_company: text(w.requester_company),
    field_confidence: w.field_confidence,
    overall_confidence: w.overall_confidence,
    injection_detected: w.injection_detected,
    model_notes: { missing: w.missing_notes, conflicting: w.conflicting_notes },
  };
}

/** ShipmentRequest → wire (test doubles and fixtures speak the wire, as a model would). A piece's three
 *  dimensions must share one unit on the wire. */
export function toWire(r: ShipmentRequest): ExtractionWire {
  const place = (p: ShipmentRequest["origin"]) => ({
    raw: p.raw,
    unlocode: p.unlocode ?? "",
    iata: p.iata ?? "",
    country: p.country ?? "",
    postcode: p.postcode ?? "",
  });
  return {
    mode: r.mode,
    service: r.service,
    origin: place(r.origin),
    destination: place(r.destination),
    containers: r.cargo.containers,
    pieces: r.cargo.pieces.map((p) => {
      if (p.width.unit !== p.length.unit || p.height.unit !== p.length.unit) throw new Error("toWire: mixed dimension units");
      return {
        qty: p.qty,
        length: p.length.value,
        width: p.width.value,
        height: p.height.value,
        dimension_unit: p.length.unit,
        weight_each: p.weight_each?.value ?? "",
        weight_unit: p.weight_each?.unit ?? "kg",
        stackable: fromTri(p.stackable),
      };
    }),
    total_weight: r.cargo.stated_total_weight?.value ?? "",
    total_weight_unit: r.cargo.stated_total_weight?.unit ?? "kg",
    total_volume: r.cargo.stated_total_volume?.value ?? "",
    total_volume_unit: r.cargo.stated_total_volume?.unit ?? "cbm",
    commodity: r.cargo.commodity ?? "",
    dangerous_goods: fromTri(r.cargo.dangerous_goods),
    temperature_controlled: fromTri(r.cargo.temperature_controlled),
    incoterm: r.incoterm ?? "NONE",
    ready_date: r.ready_date ?? "",
    requester_name: r.requester_name ?? "",
    requester_company: r.requester_company ?? "",
    field_confidence: r.field_confidence,
    overall_confidence: r.overall_confidence,
    injection_detected: r.injection_detected,
    missing_notes: r.model_notes.missing,
    conflicting_notes: r.model_notes.conflicting,
  };
}
