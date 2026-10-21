import { gateRequest } from "../packages/core/src/gate/gate.js";
import { price } from "../packages/core/src/pricing/engine.js";
import { toMajorString } from "../packages/core/src/money/money.js";
import type { ShipmentRequest } from "../packages/core/src/request/schema.js";
import { offlineTenant } from "../packages/agents/src/pipeline/tenant.js";
import { place } from "../packages/agents/src/pipeline/testing.js";
import type { Fixture } from "./score.js";

/**
 * Engine-derived expectations. Each fixture's `expected.extraction` is the GOLD reading of its email;
 * pricing that gold request on the fixture's tenant and date gives the outcome a perfect extractor
 * would reach. Stored expectations must equal this derivation (expectations.test.ts), so a tariff or
 * engine change can never silently leave a stale expected total in the golden set.
 */

export function goldRequest(f: Fixture): ShipmentRequest {
  const x = f.expected.extraction;
  return {
    mode: (x.mode ?? "UNKNOWN") as ShipmentRequest["mode"],
    service: (x.service ?? "PORT_TO_PORT") as ShipmentRequest["service"],
    origin: place(x.origin ?? "", x.origin ?? null),
    destination: place(x.destination ?? "", x.destination ?? null),
    cargo: {
      containers: Object.entries(x.containers ?? {}).map(([iso, qty]) => ({ type_raw: iso, qty })),
      pieces: [],
      stated_total_weight: x.weight_kg ? { value: x.weight_kg, unit: "kg" } : null,
      stated_total_volume: x.volume_cbm ? { value: x.volume_cbm, unit: "cbm" } : null,
      commodity: null,
      dangerous_goods: null,
      temperature_controlled: null,
    },
    incoterm: null,
    ready_date: x.ready_date ?? null,
    requester_name: null,
    requester_company: null,
    field_confidence: [],
    overall_confidence: 1,
    injection_detected: false,
    model_notes: { missing: [], conflicting: [] },
  };
}

export type Derived =
  | { decision: "quote"; quote: { currency: string; total: string; options: number } }
  | { decision: "escalate"; escalation_reason: string };

/** Gate + price the gold request on the fixture's tenant and as-of date (no model involved). */
export async function derive(f: Fixture): Promise<Derived> {
  const gate = gateRequest(goldRequest(f));
  if (!gate.pass) return { decision: "escalate", escalation_reason: gate.reason };
  const { tenant, tariffs } = offlineTenant(f.tenant);
  const snapshot = await tariffs.snapshot(tenant.id, { mode: gate.input.mode, origin: gate.input.origin, destination: gate.input.destination });
  const r = price(gate.input, snapshot, tenant.pricing(f.as_of));
  if (r.kind === "unpriceable") return { decision: "escalate", escalation_reason: r.reason };
  const first = r.candidates.find((c) => c.id === r.presented[0])!;
  return { decision: "quote", quote: { currency: r.quote_currency, total: toMajorString(first.totals.quote), options: r.presented.length } };
}

/** Fixtures whose gold reading is complete enough to derive: every quote, plus escalations decided
 *  at the pricing stage (lane, expiry) — those after a gate check are asserted by the gate tests. */
export function isDerivable(f: Fixture): boolean {
  return f.expected.decision === "quote" || ["out_of_scope_lane", "rate_expired"].includes(f.expected.escalation_reason ?? "");
}
