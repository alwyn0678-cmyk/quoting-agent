import { loadSnapshot, type Tariff, type TariffWire } from "../../../core/src/tariff/model.js";
import { assembleRateCard, type RateCardLineRow, type RateCardRow } from "../rate-card-source.js";
import { RATE_CARD } from "../rate-card.js";
import { legacyCardToTariffWire } from "./legacy-card.js";

/**
 * TariffSource — the port the agent prices through. An implementation returns ONE validated, hashed
 * snapshot of the tenant's tariffs relevant to a lane (P2 adds canonical tariff tables + connectors
 * behind the same port). An invalid snapshot is a configuration error, never a silent partial.
 */

export interface TariffQuery {
  mode: string;
  origin: string;
  destination: string;
}

export interface TariffSource {
  snapshot(tenantId: string, q: TariffQuery): Promise<Tariff[]>;
}

export class TariffConfigError extends Error {
  constructor(readonly errors: string[]) {
    super(`invalid tariff snapshot: ${errors.slice(0, 5).join("; ")}`);
    this.name = "TariffConfigError";
  }
}

export function loadOrThrow(wires: readonly TariffWire[]): Tariff[] {
  const r = loadSnapshot(wires);
  if (!r.ok) throw new TariffConfigError(r.errors);
  return r.tariffs;
}

/** In-memory tariffs (mock world, tests, CLI demo). Returns the tenant's whole snapshot. */
export class StaticTariffSource implements TariffSource {
  private readonly byTenant: Map<string, Tariff[]>;

  constructor(wiresByTenant: Readonly<Record<string, readonly TariffWire[]>>) {
    this.byTenant = new Map(Object.entries(wiresByTenant).map(([t, w]) => [t, loadOrThrow(w)]));
  }

  async snapshot(tenantId: string): Promise<Tariff[]> {
    return this.byTenant.get(tenantId) ?? [];
  }
}

/** The legacy demo card as a source (back-compat for tests and the original CLI demo). */
export function legacyStaticSource(tenantId: string): StaticTariffSource {
  return new StaticTariffSource({ [tenantId]: [legacyCardToTariffWire(RATE_CARD, tenantId)] });
}

export interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

/**
 * Production legacy source: one atomic read (get_rate_card RPC, migration 0021) of the active card and
 * its lines for (tenant, mode, lane) — no torn snapshot — converted to a canonical tariff and hashed.
 */
export class SupabaseLegacyTariffSource implements TariffSource {
  constructor(private readonly client: RpcClient) {}

  async snapshot(tenantId: string, q: TariffQuery): Promise<Tariff[]> {
    const { data, error } = await this.client.rpc("get_rate_card", {
      p_tenant_id: tenantId,
      p_mode: q.mode,
      p_lane: `${q.origin}-${q.destination}`,
    });
    if (error) throw error;
    if (!data) return [];
    const { card, lines } = data as { card: RateCardRow & { id: string }; lines: RateCardLineRow[] };
    let assembled;
    try {
      assembled = assembleRateCard(card, lines);
    } catch (e) {
      throw new TariffConfigError([(e as Error).message]);
    }
    return loadOrThrow([legacyCardToTariffWire(assembled, tenantId)]);
  }
}
