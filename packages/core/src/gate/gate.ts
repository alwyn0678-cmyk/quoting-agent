import { EQUIPMENT } from "../places/equipment.js";
import { modeModule } from "../modes/modes.js";
import { checkPlace } from "../places/resolve.js";
import { normalizeCargo, type NormalizedCargo } from "../request/normalize.js";
import type { RequestField, ShipmentRequest } from "../request/schema.js";
import type { PriceInput } from "../pricing/engine.js";
import type { TariffMode } from "../tariff/model.js";
import type { EscalationReason } from "../reasons.js";

/**
 * Gate v2 — deterministic and ordered (first failing check wins), run BEFORE pricing:
 *   door service → identity (incl. code ↔ place-text check) → mode → module exists → service → special cargo → plausibility bounds → completeness →
 *   conflicts.
 * Pricing outcomes (lane, expiry, ambiguity, FX) and the confidence floor are applied after pricing
 * by the orchestrator. Every escalation names the fields involved so a clarification (P4) can ask.
 * P1a deviation from spec §9, logged: an UNKNOWN service is asked for (missing_required_field) rather
 * than rejected, because most emails between two ports never state a service type.
 */

export type GateOutcome =
  | { pass: true; input: PriceInput; cargo: NormalizedCargo }
  | { pass: false; reason: EscalationReason; missing_fields: RequestField[]; detail: string };

const stop = (reason: EscalationReason, missing_fields: RequestField[], detail: string): GateOutcome => ({
  pass: false,
  reason,
  missing_fields,
  detail,
});

export function gateRequest(req: ShipmentRequest): GateOutcome {
  // A stated door service is decided first: a door end is an address, not a port, so asking for its
  // "port" would be the wrong question (held-out fixture h09). Door legs are not priced yet.
  if (req.service === "DOOR_TO_PORT" || req.service === "PORT_TO_DOOR" || req.service === "DOOR_TO_DOOR") {
    return stop("out_of_scope_service", [], `${req.service} is not quoted yet (port-to-port only)`);
  }
  const missingPlaces: RequestField[] = [];
  if (!req.origin.unlocode) missingPlaces.push("origin");
  if (!req.destination.unlocode) missingPlaces.push("destination");
  if (missingPlaces.length > 0) return stop("missing_required_field", missingPlaces, "origin/destination port not identified");
  if (req.origin.unlocode === req.destination.unlocode) return stop("ambiguous_request", ["origin", "destination"], "origin and destination are the same place");
  // The model's codes must agree with the place text wherever code can check it (places/resolve.ts).
  const contradicted: RequestField[] = [];
  if (checkPlace(req.origin.raw, req.origin.unlocode!) === "contradicts") contradicted.push("origin");
  if (checkPlace(req.destination.raw, req.destination.unlocode!) === "contradicts") contradicted.push("destination");
  if (contradicted.length > 0) return stop("ambiguous_request", contradicted, `port code does not match the named place (${contradicted.join(", ")})`);

  if (req.mode === "UNKNOWN") return stop("missing_required_field", ["mode"], "transport mode not stated");
  const mod = modeModule(req.mode);
  if (!mod) return stop("out_of_scope_mode", [], `${req.mode} is not priced yet`);

  if (req.service === "UNKNOWN") return stop("missing_required_field", ["service"], "service (port/door) not clear");

  const cargo = normalizeCargo(req.cargo);
  const reefer = cargo.containers.some((c) => c.iso && EQUIPMENT[c.iso].kind === "reefer");
  if (req.cargo.dangerous_goods === true) return stop("out_of_scope_cargo", [], "dangerous goods are quoted by a specialist");
  if (req.cargo.temperature_controlled === true || reefer) return stop("out_of_scope_cargo", [], "temperature-controlled cargo is quoted by a specialist");

  if (cargo.oversize.length > 0) return stop("request_too_large", [], `implausible total ${cargo.oversize.join(" and ")}`);

  const missing = mod.missingFields(cargo);
  if (missing.length > 0) return stop("missing_required_field", missing, `missing: ${missing.join(", ")}`);
  if (cargo.conflicts.length > 0) return stop("conflicting_cargo", cargo.conflicts, `stated and derived ${cargo.conflicts.join(" and ")} disagree`);

  return {
    pass: true,
    cargo,
    input: {
      mode: req.mode as TariffMode,
      origin: req.origin.unlocode!,
      destination: req.destination.unlocode!,
      cargo,
      ready_date: req.ready_date,
    },
  };
}
