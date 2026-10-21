import type { ShipmentRequest } from "../../../core/src/request/schema.js";
import { RoutingMockLlmClient } from "../mock-llm.js";
import { toWire } from "./extraction-wire.js";

/** Test doubles shared by pipeline consumers (ingest, CLI, evals). Not used by production code. */

export const place = (raw: string, unlocode: string | null) => ({ raw, unlocode, iata: null, country: null, postcode: null });

/** 2 × 40HC Rotterdam → New York, port to port — the legacy demo lane (EUR 6,930 on the demo card). */
export const SAMPLE_FCL_REQUEST: ShipmentRequest = {
  mode: "FCL",
  service: "PORT_TO_PORT",
  origin: place("Rotterdam", "NLRTM"),
  destination: place("New York", "USNYC"),
  cargo: {
    containers: [{ type_raw: "40HC", qty: 2 }],
    pieces: [],
    stated_total_weight: null,
    stated_total_volume: null,
    commodity: "coffee",
    dangerous_goods: false,
    temperature_controlled: false,
  },
  incoterm: "FOB",
  ready_date: null,
  requester_name: "Maria",
  requester_company: "Apex",
  field_confidence: [],
  overall_confidence: 0.95,
  injection_detected: false,
  model_notes: { missing: [], conflicting: [] },
};

export const SAMPLE_DRAFT_CHOICE = { language: "en", formality: "formal", intro: "thanks_for_request", closing: "questions_welcome" };

/** A request in the provider wire form, as a model would return it. Deliberately malformed values
 *  (a JSON number where a decimal string belongs, too many lines) pass through so the schema sees them. */
export function asWire(request: unknown): unknown {
  try {
    return toWire(request as ShipmentRequest);
  } catch {
    return request;
  }
}

/** Routes the two pipeline calls (extraction, draft style) to canned responses. */
export function pipelineLlm(request: unknown, choice: unknown = SAMPLE_DRAFT_CHOICE): RoutingMockLlmClient {
  return new RoutingMockLlmClient({
    submit_shipment_request: { data: asWire(request), usage: { input_tokens: 300, output_tokens: 90 } },
    submit_draft_choice: { data: choice, usage: { input_tokens: 120, output_tokens: 20 } },
  });
}
