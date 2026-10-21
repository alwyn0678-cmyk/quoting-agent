import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readRateSheetWorkbook } from "../read-rate-sheet.js";
import { parseRateSheet } from "../parse-rate-sheet.js";
import { assembleRateCard } from "../rate-card-source.js";
import { priceQuote } from "../rate-engine.js";
import { RATE_CARD, type RateCard } from "../rate-card.js";
import { legacyCardToTariffWire } from "./legacy-card.js";
import { loadTariff } from "../../../core/src/tariff/model.js";
import { price } from "../../../core/src/pricing/engine.js";
import { normalizeCargo } from "../../../core/src/request/normalize.js";

const sheet = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../rates/linkport-rate-sheet.xlsx");
const TENANT = "11111111-1111-4111-8111-111111111111";

/** Old engine vs new core on the same card and request: identical total and identical line amounts. */
function assertParity(card: RateCard, containerType: string, qty: number) {
  const [o, d] = card.supported_lane.split("-") as [string, string];
  const legacy = priceQuote({ origin_port_code: o, destination_port_code: d, mode: card.mode, container_type: containerType, container_qty: qty }, card);
  const loaded = loadTariff(legacyCardToTariffWire(card, TENANT));
  if (!loaded.ok) throw new Error(loaded.errors.join("; "));
  const r = price(
    { mode: card.mode as "FCL", origin: o, destination: d, ready_date: null,
      cargo: normalizeCargo({ containers: [{ type_raw: containerType, qty }], pieces: [], stated_total_weight: null, stated_total_volume: null, commodity: null, dangerous_goods: null, temperature_controlled: null }) },
    [loaded.tariff],
    { as_of: "2026-10-21", quote_currency: "EUR", max_options: 3, quote_validity_days: 14, fx: null, margin_rules: [] },
  );
  if (r.kind !== "priced") throw new Error(`${card.supported_lane} ${containerType}: ${JSON.stringify(r)}`);
  const opt = r.candidates[0]!;
  expect(opt.totals.quote.minor).toBe(BigInt(legacy.all_in_total) * 100n);
  const legacyLines = [
    [`BASE`, legacy.base_per_container * qty],
    ...legacy.surcharges.map((s) => [s.code, s.amount_per_container * qty] as const),
    ...legacy.per_shipment_fees.map((f) => [f.code, f.amount] as const),
  ].map(([code, eur]) => `${code}:${BigInt(eur) * 100n}`);
  const newLines = opt.legs[0]!.lines.map((l) => `${l.code.startsWith("BASE_") ? "BASE" : l.code}:${l.sell.minor}`);
  expect(newLines).toEqual(legacyLines);
  expect(opt.legs[0]!.lines.every((l) => l.buy === null)).toBe(true); // legacy cards are SELL rates
}

describe("P1a task 9 — legacy rate cards price identically through the new core", () => {
  it("the static demo card: every container type, several quantities", () => {
    for (const ct of ["20GP", "40GP", "40HC"]) for (const qty of [1, 2, 3, 7]) assertParity(RATE_CARD, ct, qty);
  });
  it("every lane of the committed Excel sheet (FCL incl. 45HC, and barge)", async () => {
    const cards = parseRateSheet(await readRateSheetWorkbook(sheet)).map((p) => assembleRateCard(p.card, p.lines));
    expect(cards.length).toBeGreaterThanOrEqual(4);
    for (const card of cards) {
      for (const ct of Object.keys(card.base_per_container)) for (const qty of [1, 4]) assertParity(card, ct, qty);
    }
  });
  it("the converted tariff carries the legacy card's validity and a stable identity", () => {
    const w = legacyCardToTariffWire(RATE_CARD, TENANT);
    expect(w.valid_to).toBe(RATE_CARD.validity_through);
    expect(w.lines.every((l) => l.price_kind === "SELL")).toBe(true);
    expect(legacyCardToTariffWire(RATE_CARD, TENANT)).toEqual(w);
  });
});

describe("TariffSource adapters", () => {
  it("Supabase legacy source: one atomic RPC read → validated, hashed tariff", async () => {
    const { SupabaseLegacyTariffSource } = await import("./tariff-source.js");
    const calls: unknown[] = [];
    const client = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return {
          data: {
            card: { id: "c1", mode: "FCL", version: "2026-10-v1", validity_through: "2026-12-31", lane: "NLRTM-USNYC" },
            lines: [
              { kind: "base", code: "BASE_40HC", container_type: "40HC", amount: 2550, sort_order: 0 },
              { kind: "per_shipment_fee", code: "DOC", container_type: null, amount: 65, sort_order: 0 },
            ],
          },
          error: null,
        };
      },
    };
    const tariffs = await new SupabaseLegacyTariffSource(client).snapshot(TENANT, { mode: "FCL", origin: "NLRTM", destination: "USNYC" });
    expect(calls).toEqual([{ fn: "get_rate_card", args: { p_tenant_id: TENANT, p_mode: "FCL", p_lane: "NLRTM-USNYC" } }]);
    expect(tariffs).toHaveLength(1);
    expect(tariffs[0]!.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("no active card → empty snapshot (the engine reports the lane as out of scope)", async () => {
    const { SupabaseLegacyTariffSource } = await import("./tariff-source.js");
    const empty = await new SupabaseLegacyTariffSource({ rpc: async () => ({ data: null, error: null }) }).snapshot(TENANT, { mode: "FCL", origin: "NLRTM", destination: "USLAX" });
    expect(empty).toEqual([]);
  });
  it("an invalid card is a configuration error, never a partial snapshot", async () => {
    const { SupabaseLegacyTariffSource, TariffConfigError } = await import("./tariff-source.js");
    const bad = { rpc: async () => ({ data: { card: { id: "c", mode: "FCL", version: "v", validity_through: "2026-12-31", lane: "NLRTM-USNYC" }, lines: [{ kind: "base", code: "B", container_type: "40HC", amount: -1, sort_order: 0 }] }, error: null }) };
    await expect(new SupabaseLegacyTariffSource(bad).snapshot(TENANT, { mode: "FCL", origin: "NLRTM", destination: "USNYC" })).rejects.toBeInstanceOf(TariffConfigError);
  });
});
