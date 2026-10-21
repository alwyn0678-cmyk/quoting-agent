import { z } from "zod";
import { IsoDateSchema } from "../time/dates.js";

/**
 * ShipmentRequest v2 — the extraction contract (what the model may report about an email). It is
 * deliberately "as written": raw equipment text, measurements with the units the email used, and
 * decimal STRINGS (never JSON numbers) for every price-affecting quantity. Code — not the model — maps
 * equipment to ISO codes and converts units (request/normalize.ts). Hard limits bound every collection
 * and string so a hostile email cannot exhaust the pricing engine.
 */

/** Strictly positive decimal string: up to 9 integer digits and 6 decimals, no sign, no exponent. */
const positiveDecimal = z
  .string()
  .regex(/^\d{1,9}(\.\d{1,6})?$/, "positive decimal string")
  .refine((s) => /[1-9]/.test(s), "must be greater than zero");

export const WeightUnit = z.enum(["kg", "lb", "t"]);
export const LengthUnit = z.enum(["mm", "cm", "m", "in", "ft"]);
export const VolumeUnit = z.enum(["cbm", "cft"]);

export const WeightSchema = z.object({ value: positiveDecimal, unit: WeightUnit }).strict();
export const LengthSchema = z.object({ value: positiveDecimal, unit: LengthUnit }).strict();
export const VolumeSchema = z.object({ value: positiveDecimal, unit: VolumeUnit }).strict();

export const RequestModeSchema = z.enum([
  "FCL", "LCL", "AIR", "EXPRESS", "FTL", "LTL", "DRAYAGE", "RAIL", "BARGE", "MULTIMODAL", "UNKNOWN",
]);
export const ServiceSchema = z.enum(["PORT_TO_PORT", "DOOR_TO_PORT", "PORT_TO_DOOR", "DOOR_TO_DOOR", "UNKNOWN"]);
export const IncotermSchema = z.enum(["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"]);

const shortText = (max: number) => z.string().max(max);

export const PlaceSchema = z.object({
  raw: shortText(200),
  unlocode: z.string().regex(/^[A-Z]{2}[A-Z2-9]{3}$/).nullable(),
  iata: z.string().regex(/^[A-Z]{3}$/).nullable(),
  country: z.string().regex(/^[A-Z]{2}$/).nullable(),
  postcode: shortText(16).nullable(),
}).strict();

export const ContainerLineSchema = z.object({
  type_raw: shortText(40),
  qty: z.number().int().min(1).max(999),
}).strict();

export const PieceSchema = z.object({
  qty: z.number().int().min(1).max(10_000),
  length: LengthSchema,
  width: LengthSchema,
  height: LengthSchema,
  weight_each: WeightSchema.nullable(),
  stackable: z.boolean().nullable(),
}).strict();

export const CargoSchema = z.object({
  containers: z.array(ContainerLineSchema).max(50),
  pieces: z.array(PieceSchema).max(500),
  stated_total_weight: WeightSchema.nullable(),
  stated_total_volume: VolumeSchema.nullable(),
  commodity: shortText(200).nullable(),
  dangerous_goods: z.boolean().nullable(),
  temperature_controlled: z.boolean().nullable(),
}).strict();

export const RequestFieldSchema = z.enum([
  "origin", "destination", "mode", "service", "containers", "pieces", "weight", "volume", "incoterm", "ready_date",
]);

export const ShipmentRequestSchema = z.object({
  mode: RequestModeSchema,
  service: ServiceSchema,
  origin: PlaceSchema,
  destination: PlaceSchema,
  cargo: CargoSchema,
  incoterm: IncotermSchema.nullable(),
  ready_date: IsoDateSchema.nullable(),
  requester_name: shortText(120).nullable(),
  requester_company: shortText(160).nullable(),
  field_confidence: z.array(z.object({ field: RequestFieldSchema, confidence: z.number().min(0).max(1) }).strict()).max(20),
  overall_confidence: z.number().min(0).max(1),
  injection_detected: z.boolean(),
  model_notes: z.object({
    missing: z.array(shortText(120)).max(20),
    conflicting: z.array(shortText(200)).max(20),
  }).strict(),
}).strict();

export type ShipmentRequest = z.infer<typeof ShipmentRequestSchema>;
export type Cargo = z.infer<typeof CargoSchema>;
export type RequestMode = z.infer<typeof RequestModeSchema>;
export type RequestField = z.infer<typeof RequestFieldSchema>;
export type Piece = z.infer<typeof PieceSchema>;
