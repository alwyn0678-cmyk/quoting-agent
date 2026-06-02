import { priceQuote, type PriceRequest, type RateEngine } from "../../agents/src/rate-engine.js";
import {
  assembleRateCard,
  type RateCardSource,
  type RateCardLineRow,
  type RateCardRow,
} from "../../agents/src/rate-card-source.js";
import type { RateCard } from "../../agents/src/rate-card.js";
import type { RateQuote } from "../../agents/src/schemas.js";

/**
 * ExcelOnline rate-engine adapter (1B.6) — the "operate your own Excel" wedge. Reads the forwarder's
 * rate card from a workbook via MS Graph and prices through the SAME `priceQuote()` as every other
 * adapter, so its RateQuote is identical to the StaticCard's (AC-3). READ-ONLY by construction: the
 * transport exposes no write, and this adapter exposes no write method (P-EXCEL-RO / AUTONOMY R7).
 *
 * GATED: the live Excel-via-Graph integration is the plan's top schedule risk and is decided at the
 * Wednesday-Week-6 POC (DECISION_LOG). The fallback, if it slips, is to ship on SupabaseTable. Here
 * the adapter LOGIC is built + parity-proven hermetically over a fake transport; the live transport
 * (Graph workbook ranges + client-credentials auth) is wired in 1C.
 */

/** Read-only view of the forwarder's rate-card workbook. No write/update method exists (R7). */
export interface ExcelWorkbookTransport {
  readCardMeta(): Promise<RateCardRow>;
  readLines(): Promise<RateCardLineRow[]>;
}

/** A RateCardSource backed by an Excel workbook. */
export class ExcelRateCardSource implements RateCardSource {
  constructor(private readonly workbook: ExcelWorkbookTransport) {}

  async fetchActiveCard(_tenantId: string, _mode: string, _lane: string) {
    const [card, lines] = await Promise.all([this.workbook.readCardMeta(), this.workbook.readLines()]);
    return { card, lines };
  }
}

export class ExcelOnlineRateEngine implements RateEngine {
  constructor(
    private readonly source: ExcelRateCardSource,
    private readonly tenantId: string,
    private readonly lane: string,
  ) {}

  async cardFor(req: PriceRequest): Promise<RateCard | null> {
    const found = await this.source.fetchActiveCard(this.tenantId, req.mode, this.lane);
    return found ? assembleRateCard(found.card, found.lines) : null;
  }

  async price(req: PriceRequest): Promise<RateQuote> {
    const card = await this.cardFor(req);
    if (!card) throw new Error(`no Excel rate card for tenant ${this.tenantId}, ${req.mode} lane ${this.lane}`);
    return priceQuote(req, card);
  }
}
