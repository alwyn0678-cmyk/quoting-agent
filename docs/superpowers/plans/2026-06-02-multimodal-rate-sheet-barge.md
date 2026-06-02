# Multi‑modal rate sheet — barge (NLRTM→DEDUI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make **barge** a priceable mode on lane **NLRTM→DEDUI**, by generalising the engine + gate from "FCL‑only / single card" to a **mode‑keyed** rate sheet, so rail/truck/air become cheap follow‑ons.

**Architecture:** Mode becomes a first‑class card key. A `MODE_BASIS` map (in `rate-card.ts`) maps each mode to a pricing basis; only `per_container` is implemented (FCL, BARGE, RAIL) — air/truck bases are reserved and refuse until built (YAGNI seam). The `RateEngine` port gains `cardFor(req)` so the gate and engine resolve the **same** card for the request's (mode, lane); the gate validates against that resolved card instead of a hardcoded FCL card. Barge reuses the existing per‑container `priceQuote()` byte‑for‑byte.

**Tech Stack:** TypeScript ESM (strict), Vitest, Zod, Supabase Postgres, exceljs (rate sheet). Whole‑EUR integer pricing.

**Spec:** `docs/superpowers/specs/2026-06-02-multimodal-rate-sheet-barge-design.md`

**Barge card data (single source — used by tests AND the sheet). All figures INVENTED (ASSUMPTIONS).**
- Lane `NLRTM-DEDUI`, mode `BARGE`, version `2026-06-v1`, valid `2026-06-30`.
- base: `20GP`=280, `40GP`=420, `40HC`=420.
- surcharges (per container): `LWS`=95, `THC_RTM_BARGE`=95, `THC_DUI`=110.
- per_shipment_fee: `DOC`=35.
- Worked totals: `1×40HC` = 420 + (95+95+110) + 35 = **755**; `2×20GP` = 2×(280+300) + 35 = **1195**.

**Branch:** create `feat/barge-rate-mode` off `main` before Task 1 (`git switch -c feat/barge-rate-mode`).

---

### Task 1: Modes vocabulary on the card

**Files:**
- Modify: `packages/agents/src/rate-card.ts`
- Test: `packages/agents/src/rate-card.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/agents/src/rate-card.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { RATE_CARD, MODE_BASIS, isPriceableMode } from "./rate-card.js";

describe("mode vocabulary", () => {
  it("RATE_CARD is FCL", () => {
    expect(RATE_CARD.mode).toBe("FCL");
  });
  it("container modes map to per_container", () => {
    expect(MODE_BASIS.FCL).toBe("per_container");
    expect(MODE_BASIS.BARGE).toBe("per_container");
    expect(MODE_BASIS.RAIL).toBe("per_container");
  });
  it("air/truck bases are reserved but not yet priceable", () => {
    expect(MODE_BASIS.AIR).toBe("per_chargeable_kg");
    expect(MODE_BASIS.TRUCK).toBe("per_ldm");
    expect(isPriceableMode("AIR")).toBe(false);
    expect(isPriceableMode("TRUCK")).toBe(false);
  });
  it("priceable = mapped AND implemented basis", () => {
    expect(isPriceableMode("FCL")).toBe(true);
    expect(isPriceableMode("BARGE")).toBe(true);
    expect(isPriceableMode("LCL")).toBe(false); // unmapped
    expect(isPriceableMode("UNKNOWN")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/agents/src/rate-card.test.ts`
Expected: FAIL — `MODE_BASIS`/`isPriceableMode` not exported; `RATE_CARD.mode` undefined.

- [ ] **Step 3: Implement**

In `packages/agents/src/rate-card.ts`: add `mode` to the interface, set it on `RATE_CARD`, and add the modes vocabulary.

Add to the `RateCard` interface (first field):
```ts
export interface RateCard {
  mode: string; // transport mode this card prices (FCL, BARGE, RAIL, …)
  version: string;
```
Set on `RATE_CARD`:
```ts
export const RATE_CARD: RateCard = {
  mode: "FCL",
  version: "2026-06-v1",
```
Append to the end of the file:
```ts
/** Pricing basis per mode. per_container is implemented; the others are reserved for later modes. */
export type PricingBasis = "per_container" | "per_chargeable_kg" | "per_ldm";
export const MODE_BASIS: Record<string, PricingBasis> = {
  FCL: "per_container",
  BARGE: "per_container",
  RAIL: "per_container",
  AIR: "per_chargeable_kg",
  TRUCK: "per_ldm",
};
/** Bases the engine can actually price today. Air/truck land here when those modes are built. */
const IMPLEMENTED_BASES = new Set<PricingBasis>(["per_container"]);
/** A mode is priceable iff it maps to a basis AND that basis is implemented. */
export function isPriceableMode(mode: string): boolean {
  const basis = MODE_BASIS[mode];
  return basis !== undefined && IMPLEMENTED_BASES.has(basis);
}
```

- [ ] **Step 4: Fix the existing engine test's card literal**

In `packages/agents/src/rate-engine.test.ts`, the `uslaxCard` literal (~line 126) must satisfy the new required field. Change its first line:
```ts
  const uslaxCard: RateCard = {
    mode: "FCL",
    version: "2026-06-v1",
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/agents/src/rate-card.test.ts packages/agents/src/rate-engine.test.ts`
Expected: PASS (new file passes; engine tests still pass — `RATE_CARD.mode`/`uslaxCard.mode` now present).

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/rate-card.ts packages/agents/src/rate-card.test.ts packages/agents/src/rate-engine.test.ts
git commit -m "feat(rates): add mode to RateCard + MODE_BASIS vocabulary"
```

---

### Task 2: Generalise `priceQuote` dispatch (barge prices)

**Files:**
- Modify: `packages/agents/src/rate-engine.ts:43-46`
- Test: `packages/agents/src/rate-engine.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/agents/src/rate-engine.test.ts` (`RateCard` is already imported in this file):
```ts
describe("AC-B1/B2/B3 — barge (per_container) via the same engine", () => {
  const bargeCard: RateCard = {
    mode: "BARGE",
    version: "2026-06-v1",
    validity_through: "2026-06-30",
    supported_lane: "NLRTM-DEDUI",
    base_per_container: { "20GP": 280, "40GP": 420, "40HC": 420 },
    surcharges: [
      { code: "LWS", amount_per_container: 95 },
      { code: "THC_RTM_BARGE", amount_per_container: 95 },
      { code: "THC_DUI", amount_per_container: 110 },
    ],
    per_shipment_fees: [{ code: "DOC", amount: 35 }],
  };
  const bargeReq = (over: Partial<PriceRequest> = {}): PriceRequest => ({
    origin_port_code: "NLRTM",
    destination_port_code: "DEDUI",
    mode: "BARGE",
    container_type: "40HC",
    container_qty: 1,
    ...over,
  });

  it("AC-B1: 1×40HC barge = 755 EUR (incl. LWS)", () => {
    const q = priceQuote(bargeReq(), bargeCard);
    expect(q.all_in_total).toBe(755);
    expect(q.lane).toBe("NLRTM-DEDUI");
    expect(q.surcharges.find((s) => s.code === "LWS")?.amount_per_container).toBe(95);
  });
  it("AC-B1: 2×20GP barge = 1195 EUR", () => {
    expect(priceQuote(bargeReq({ container_type: "20GP", container_qty: 2 }), bargeCard).all_in_total).toBe(1195);
  });
  it("AC-B2: AIR (basis not implemented) → out_of_scope_mode", () => {
    const call = () => priceQuote(bargeReq({ mode: "AIR" }), bargeCard);
    expect(call).toThrow(UnpriceableRequestError);
    try { call(); } catch (e) { expect((e as UnpriceableRequestError).reason).toBe("out_of_scope_mode"); }
  });
  it("AC-B3: FCL request against a BARGE card → out_of_scope_mode", () => {
    const call = () => priceQuote(bargeReq({ mode: "FCL" }), bargeCard);
    expect(call).toThrow(UnpriceableRequestError);
    try { call(); } catch (e) { expect((e as UnpriceableRequestError).reason).toBe("out_of_scope_mode"); }
  });
  it("AC-B3: barge on a non-barge lane → out_of_scope_lane", () => {
    const call = () => priceQuote(bargeReq({ destination_port_code: "USNYC" }), bargeCard);
    expect(call).toThrow(UnpriceableRequestError);
    try { call(); } catch (e) { expect((e as UnpriceableRequestError).reason).toBe("out_of_scope_lane"); }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/agents/src/rate-engine.test.ts -t AC-B`
Expected: FAIL — current code throws `out_of_scope_mode` for any non‑FCL, so the barge pricing cases fail.

- [ ] **Step 3: Implement the dispatch**

In `packages/agents/src/rate-engine.ts`: update the import and replace the FCL hardcheck (lines 1, 43‑46).

Change the import line 1 to include the vocabulary:
```ts
import { RATE_CARD, MODE_BASIS, isPriceableMode, type RateCard } from "./rate-card.js";
```
Replace lines 44‑46 (the `if (req.mode !== "FCL") …` block) with:
```ts
  if (!isPriceableMode(req.mode)) {
    throw new UnpriceableRequestError("out_of_scope_mode", `mode '${req.mode}' is not priceable`);
  }
  if (card.mode !== req.mode) {
    throw new UnpriceableRequestError(
      "out_of_scope_mode",
      `card mode '${card.mode}' does not match request mode '${req.mode}'`,
    );
  }
```
(Everything below — lane check, container, qty, the per_container sum — is unchanged; `MODE_BASIS` is only `per_container` here so the existing math is correct.)

- [ ] **Step 4: Run to verify pass (and no regression)**

Run: `npx vitest run packages/agents/src/rate-engine.test.ts`
Expected: PASS — barge cases pass; the existing FCL T4/T5/P‑1A.2/Q2 cases still pass (FCL is priceable, `RATE_CARD.mode === "FCL"`, LCL still `out_of_scope_mode`).

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/rate-engine.ts packages/agents/src/rate-engine.test.ts
git commit -m "feat(rates): priceQuote dispatches on mode basis; barge prices per-container"
```

---

### Task 3: `cardFor` on the RateEngine port

**Files:**
- Modify: `packages/agents/src/rate-engine.ts` (interface + `StaticCardRateEngine`)
- Test: `packages/agents/src/rate-engine.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/agents/src/rate-engine.test.ts`:
```ts
describe("cardFor — resolve the card for a request's mode+lane", () => {
  it("StaticCard returns its card on a matching mode+lane, null otherwise", async () => {
    const eng = new StaticCardRateEngine(); // FCL NLRTM-USNYC
    expect(await eng.cardFor(inScope())).not.toBeNull();
    expect(await eng.cardFor(inScope({ mode: "BARGE" }))).toBeNull();           // wrong mode
    expect(await eng.cardFor(inScope({ destination_port_code: "DEDUI" }))).toBeNull(); // wrong lane
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/agents/src/rate-engine.test.ts -t cardFor`
Expected: FAIL — `cardFor` not a function.

- [ ] **Step 3: Implement**

In `packages/agents/src/rate-engine.ts`, add `cardFor` to the `RateEngine` interface:
```ts
export interface RateEngine {
  price(req: PriceRequest): Promise<RateQuote>;
  /** Resolve the active card for this request's (mode, lane); null if none. Lets the gate and the
   *  engine validate against the SAME card. */
  cardFor(req: PriceRequest): Promise<RateCard | null>;
}
```
Add the method to `StaticCardRateEngine` (alongside `price`):
```ts
  async cardFor(req: PriceRequest): Promise<RateCard | null> {
    const lane = `${req.origin_port_code ?? "?"}-${req.destination_port_code ?? "?"}`;
    return this.card.mode === req.mode && this.card.supported_lane === lane ? this.card : null;
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run packages/agents/src/rate-engine.test.ts -t cardFor`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/rate-engine.ts packages/agents/src/rate-engine.test.ts
git commit -m "feat(rates): add cardFor(req) to the RateEngine port + StaticCard"
```

---

### Task 4: Generalise the gate + wire agent card‑resolution

**Files:**
- Modify: `packages/agents/src/gate.ts`
- Modify: `packages/agents/src/agent.ts:31` (+ build req before the gate)
- Test: `packages/agents/src/gate.test.ts`

- [ ] **Step 1: Write the failing tests (AC-B7) + migrate existing gate tests to the new signature**

In `packages/agents/src/gate.test.ts`, the helper that builds an `ExtractionResult` stays; update `decide(x)` calls to pass a card. Add a barge card + these cases (adapt the file's existing `make`/builder helper name):
```ts
import { RATE_CARD, type RateCard } from "./rate-card.js";

const bargeCard: RateCard = {
  mode: "BARGE", version: "2026-06-v1", validity_through: "2026-06-30", supported_lane: "NLRTM-DEDUI",
  base_per_container: { "20GP": 280, "40GP": 420, "40HC": 420 },
  surcharges: [{ code: "LWS", amount_per_container: 95 }],
  per_shipment_fees: [{ code: "DOC", amount: 35 }],
};

describe("AC-B7 — gate generalised to mode+resolved card", () => {
  // `make(...)` = the file's existing ExtractionResult builder; mode/ports overridable.
  it("in-scope barge → quote", () => {
    const x = make({ mode: "BARGE", origin: "NLRTM", destination: "DEDUI", container_type: "40HC", qty: 1, confidence: 0.9 });
    expect(decide(x, bargeCard)).toEqual({ decision: "quote", reason: null });
  });
  it("AIR → out_of_scope_mode (basis not implemented)", () => {
    const x = make({ mode: "AIR", origin: "NLRTM", destination: "DEDUI", container_type: "40HC", qty: 1, confidence: 0.9 });
    expect(decide(x, null)).toEqual({ decision: "escalate", reason: "out_of_scope_mode" });
  });
  it("priceable mode but no card (cardFor → null) → out_of_scope_lane", () => {
    const x = make({ mode: "BARGE", origin: "NLRTM", destination: "USNYC", container_type: "40HC", qty: 1, confidence: 0.9 });
    expect(decide(x, null)).toEqual({ decision: "escalate", reason: "out_of_scope_lane" });
  });
});
```
Also update every existing `decide(x)` call in this file: in‑scope FCL cases → `decide(x, RATE_CARD)`; the existing "out_of_scope_lane" case → `decide(x, null)`; the existing "out_of_scope_mode (LCL)" case → `decide(x, RATE_CARD)` (LCL is unmapped, escalates before the card check).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/agents/src/gate.test.ts`
Expected: FAIL — `decide` still has the old signature/logic (hardcoded FCL; lane vs `card.supported_lane`).

- [ ] **Step 3: Implement the gate**

Replace the body of `decide` in `packages/agents/src/gate.ts`. Update imports and signature:
```ts
import { RATE_CARD, isPriceableMode, type RateCard } from "./rate-card.js";
import type { ExtractionResult, EscalationReason } from "./schemas.js";
```
```ts
export function decide(x: ExtractionResult, card: RateCard | null = RATE_CARD): GateDecision {
  const escalate = (reason: EscalationReason): GateDecision => ({ decision: "escalate", reason });

  // 1. Identity fields needed to locate a lane at all.
  if (x.origin.port_code === null || x.destination.port_code === null) {
    return escalate("missing_required_field");
  }
  // 2. Mode: UNKNOWN = missing; a mode with no implemented pricing basis = out of scope.
  if (x.mode === "UNKNOWN") return escalate("missing_required_field");
  if (!isPriceableMode(x.mode)) return escalate("out_of_scope_mode");

  // 3. The (mode, lane) card must exist (resolved by the engine via cardFor and passed in).
  if (card === null) return escalate("out_of_scope_lane");

  // 4. Container type must be present (priceability on the card is guaranteed by extraction's set).
  if (x.container_type === null || x.container_type === "UNKNOWN") {
    return escalate("missing_required_field");
  }
  // 5. Quantity must be present.
  if (x.container_qty === null) return escalate("missing_required_field");

  // 6. Everything present and in scope, but the model is unsure -> human review.
  if (x.overall_confidence < CONFIDENCE_THRESHOLD) return escalate("low_confidence");

  return { decision: "quote", reason: null };
}
```

- [ ] **Step 4: Wire `agent.ts` to resolve the card before the gate**

In `packages/agents/src/agent.ts`, replace line 31 (`const gate = decide(extraction);`) with a resolve‑then‑gate block, and reuse the same `req` for pricing. Replace lines 30‑31 and the `engine.price({...})` call (lines 45‑51) so the request object is built once:
```ts
  const { extraction, usage: extractionUsage } = await extractRequest(email, client, routing.extraction);

  const priceReq = {
    origin_port_code: extraction.origin.port_code,
    destination_port_code: extraction.destination.port_code,
    mode: extraction.mode,
    container_type: extraction.container_type,
    container_qty: extraction.container_qty,
  };
  const card = await engine.cardFor(priceReq);
  const gate = decide(extraction, card);
```
Then in the `if (gate.decision === "quote")` block, replace the `quote = await engine.price({ … })` literal with:
```ts
    quote = await engine.price(priceReq);
```

- [ ] **Step 5: Run gate + agent + full agents suite**

Run: `npx vitest run packages/agents/src/gate.test.ts packages/agents/src/agent.test.ts packages/agents/src`
Expected: PASS — gate AC‑B7 passes; `agent.test.ts` still passes (StaticCard `cardFor` returns `RATE_CARD` for the FCL golden cases, `null` for out‑of‑scope → same decisions as before).

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/gate.ts packages/agents/src/gate.test.ts packages/agents/src/agent.ts
git commit -m "feat(rates): gate validates against the resolved (mode,lane) card; agent resolves via cardFor"
```

---

### Task 5: Supabase source + engine resolve by (tenant, mode, lane)

**Files:**
- Modify: `packages/agents/src/rate-card-source.ts` (row `mode`, `fetchActiveCard` signature, `assembleRateCard`)
- Modify: `packages/agents/src/supabase-rate-engine.ts`
- Modify: `scripts/poll_once.ts`, `packages/trigger/src/trigger/run.ts` (drop `DEFAULT_LANE` arg)
- Test: `packages/agents/src/supabase-rate-engine.test.ts`

- [ ] **Step 1: Write the failing tests (AC-B5, AC-B6) with a mocked source**

Add to `packages/agents/src/supabase-rate-engine.test.ts` (a fake in‑memory `RateCardSource` keyed by mode+lane):
```ts
import { describe, it, expect } from "vitest";
import { SupabaseTableRateEngine } from "./supabase-rate-engine.js";
import type { RateCardSource } from "./rate-card-source.js";

const bargeRows = {
  card: { mode: "BARGE", version: "2026-06-v1", validity_through: "2026-06-30", lane: "NLRTM-DEDUI" },
  lines: [
    { kind: "base", code: "BASE_40HC", container_type: "40HC", amount: 420, sort_order: 0 },
    { kind: "surcharge_per_container", code: "LWS", container_type: null, amount: 95, sort_order: 0 },
    { kind: "surcharge_per_container", code: "THC_RTM_BARGE", container_type: null, amount: 95, sort_order: 1 },
    { kind: "surcharge_per_container", code: "THC_DUI", container_type: null, amount: 110, sort_order: 2 },
    { kind: "per_shipment_fee", code: "DOC", container_type: null, amount: 35, sort_order: 0 },
  ],
} as const;

const fakeSource = (): RateCardSource => ({
  async fetchActiveCard(_tenant, mode, lane) {
    if (mode === "BARGE" && lane === "NLRTM-DEDUI") return structuredClone(bargeRows) as any;
    return null;
  },
});

const bargeReq = {
  origin_port_code: "NLRTM", destination_port_code: "DEDUI", mode: "BARGE",
  container_type: "40HC", container_qty: 1,
} as const;

describe("AC-B5/B6 — Supabase engine resolves + prices by (mode, lane)", () => {
  it("AC-B5: a (BARGE, NLRTM-DEDUI) card prices to 755 with mode carried through", async () => {
    const eng = new SupabaseTableRateEngine(fakeSource(), "11111111-1111-4111-8111-111111111111");
    const q = await eng.price(bargeReq);
    expect(q.all_in_total).toBe(755);
    expect(q.lane).toBe("NLRTM-DEDUI");
  });
  it("AC-B6: resolution is by request — FCL on the barge source returns null", async () => {
    const eng = new SupabaseTableRateEngine(fakeSource(), "t");
    expect(await eng.cardFor(bargeReq)).not.toBeNull();
    expect(await eng.cardFor({ ...bargeReq, mode: "FCL" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/agents/src/supabase-rate-engine.test.ts`
Expected: FAIL — `fetchActiveCard` takes `(tenant, lane)`, the engine constructor takes a `lane`, and there is no `cardFor`.

- [ ] **Step 3: Implement the source changes**

In `packages/agents/src/rate-card-source.ts`: add `mode` to `RateCardRow`, to `assembleRateCard`'s output, and to the `fetchActiveCard` signature.
```ts
export interface RateCardRow {
  mode: string;
  version: string;
  validity_through: string; // 'YYYY-MM-DD'
  lane: string;
}
```
```ts
export interface RateCardSource {
  fetchActiveCard(
    tenantId: string,
    mode: string,
    lane: string,
  ): Promise<{ card: RateCardRow; lines: RateCardLineRow[] } | null>;
}
```
In `assembleRateCard`, add `mode` to the returned object (first field):
```ts
  return {
    mode: card.mode,
    version: card.version,
```

- [ ] **Step 4: Implement the engine + real source**

Replace `SupabaseTableRateEngine` and `SupabaseRateCardSource.fetchActiveCard` + `createSupabaseRateEngine` in `packages/agents/src/supabase-rate-engine.ts`:
```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { priceQuote, UnpriceableRequestError, type PriceRequest, type RateEngine } from "./rate-engine.js";
import { assembleRateCard, type RateCardSource, type RateCardLineRow } from "./rate-card-source.js";
import type { RateCard } from "./rate-card.js";
import type { RateQuote } from "./schemas.js";

export class SupabaseTableRateEngine implements RateEngine {
  constructor(
    private readonly source: RateCardSource,
    private readonly tenantId: string,
  ) {}

  async cardFor(req: PriceRequest): Promise<RateCard | null> {
    const lane = `${req.origin_port_code ?? "?"}-${req.destination_port_code ?? "?"}`;
    const found = await this.source.fetchActiveCard(this.tenantId, req.mode, lane);
    return found ? assembleRateCard(found.card, found.lines) : null;
  }

  async price(req: PriceRequest): Promise<RateQuote> {
    const card = await this.cardFor(req);
    if (!card) {
      const lane = `${req.origin_port_code ?? "?"}-${req.destination_port_code ?? "?"}`;
      throw new UnpriceableRequestError("out_of_scope_lane", `no active card for mode ${req.mode}, lane ${lane}`);
    }
    return priceQuote(req, card);
  }
}

export class SupabaseRateCardSource implements RateCardSource {
  constructor(private readonly client: SupabaseClient) {}

  async fetchActiveCard(tenantId: string, mode: string, lane: string) {
    const { data: card, error: cardErr } = await this.client
      .from("rate_cards")
      .select("id, mode, version, validity_through, lane")
      .eq("tenant_id", tenantId)
      .eq("mode", mode)
      .eq("lane", lane)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (cardErr) throw cardErr;
    if (!card) return null;

    const { data: lines, error: linesErr } = await this.client
      .from("rate_card_lines")
      .select("kind, code, container_type, amount, sort_order")
      .eq("rate_card_id", card.id);
    if (linesErr) throw linesErr;

    return {
      card: { mode: card.mode, version: card.version, validity_through: card.validity_through, lane: card.lane },
      lines: (lines ?? []) as RateCardLineRow[],
    };
  }
}

export function createSupabaseRateEngine(tenantId: string): SupabaseTableRateEngine {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required for the Supabase rate engine");
  }
  return new SupabaseTableRateEngine(new SupabaseRateCardSource(createClient(url, key)), tenantId);
}
```

- [ ] **Step 5: Update the two call sites (drop `DEFAULT_LANE`)**

In `scripts/poll_once.ts:41` and `packages/trigger/src/trigger/run.ts:28`, change `createSupabaseRateEngine(tenantId, DEFAULT_LANE)` → `createSupabaseRateEngine(tenantId)`. If `DEFAULT_LANE` becomes unused in either file, remove its declaration/import (only if your change orphaned it).

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run packages/agents/src/supabase-rate-engine.test.ts && npm run typecheck`
Expected: PASS; typecheck clean (the dropped arg compiles at both call sites).

- [ ] **Step 7: Commit**

```bash
git add packages/agents/src/rate-card-source.ts packages/agents/src/supabase-rate-engine.ts packages/agents/src/supabase-rate-engine.test.ts scripts/poll_once.ts packages/trigger/src/trigger/run.ts
git commit -m "feat(rates): resolve active card by (tenant, mode, lane); drop fixed DEFAULT_LANE"
```

---

### Task 6: Extraction — recognise barge

**Files:**
- Modify: `packages/agents/src/schemas.ts:19`
- Modify: `packages/agents/src/extraction.ts` (prompt guidance)
- Test: `packages/agents/src/extraction.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/agents/src/extraction.test.ts` (follow the file's existing mocked‑LLM pattern; this asserts the schema accepts BARGE and a mocked barge extraction parses):
```ts
import { modeSchema, ExtractionResultSchema } from "./schemas.js";

describe("AC-B4 — barge mode is extractable", () => {
  it("modeSchema accepts BARGE", () => {
    expect(modeSchema.parse("BARGE")).toBe("BARGE");
  });
  it("a barge extraction parses into ExtractionResult", () => {
    const parsed = ExtractionResultSchema.parse({
      origin: { raw: "Rotterdam", port_code: "NLRTM" },
      destination: { raw: "Duisburg", port_code: "DEDUI" },
      mode: "BARGE",
      container_type: "40HC",
      container_qty: 1,
      incoterm: null, commodity: null, ready_date: null, weight_kg: null,
      requester_name: null, requester_company: null,
      field_confidence: {}, overall_confidence: 0.9, injection_detected: false,
    });
    expect(parsed.mode).toBe("BARGE");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/agents/src/extraction.test.ts -t AC-B4`
Expected: FAIL — `modeSchema` rejects `"BARGE"`.

- [ ] **Step 3: Implement**

In `packages/agents/src/schemas.ts:19`:
```ts
export const modeSchema = z.enum(["FCL", "LCL", "AIR", "RAIL", "BARGE", "UNKNOWN"]);
```
In `packages/agents/src/extraction.ts`, add one line to the prompt's mode guidance (find where modes are described and append): `BARGE = inland barge (e.g. Rhine; Rotterdam→Duisburg). Inland river/canal terminals use their UN/LOCODE (Duisburg = DEDUI).`

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run packages/agents/src/extraction.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/schemas.ts packages/agents/src/extraction.ts packages/agents/src/extraction.test.ts
git commit -m "feat(rates): extraction recognises BARGE mode + inland terminals"
```

---

### Task 7: Migration + rate sheet carries mode + barge card

**Files:**
- Create: `supabase/migrations/0013_rate_card_mode.sql`
- Modify: `packages/agents/src/parse-rate-sheet.ts` (read `Mode` meta)
- Modify: `scripts/gen_rate_sheet.ts` (add the barge sheet)
- Modify: `scripts/import_rate_sheet.ts` (write `mode`, key by it)
- Test: `packages/agents/src/parse-rate-sheet.test.ts`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0013_rate_card_mode.sql`:
```sql
-- 0013 — make transport mode a first-class key on rate cards (multi-modal rate sheet).
-- Extends D-04 (one mode/one lane): a tenant can now hold cards for FCL, BARGE, RAIL, … on a lane.
-- Existing rows are FCL (the only mode before this). The active-card lookup filters on mode too
-- (code: SupabaseRateCardSource.fetchActiveCard). No new access; append-only; idempotent.
alter table public.rate_cards add column if not exists mode text not null default 'FCL';
```

- [ ] **Step 2: Write the failing parser test**

Add to `packages/agents/src/parse-rate-sheet.test.ts`:
```ts
it("AC (sheet): reads the Mode meta into card.mode", () => {
  const sheet = {
    name: "BARGE NLRTM-DEDUI",
    rows: [
      ["Mode", "BARGE"],
      ["Lane", "NLRTM-DEDUI"],
      ["Version", "2026-06-v1"],
      ["Valid through", "2026-06-30"],
      ["Kind", "code", "container_type", "amount", "sort_order"],
      ["base", "BASE_40HC", "40HC", "420", "0"],
      ["surcharge_per_container", "LWS", "", "95", "0"],
      ["per_shipment_fee", "DOC", "", "35", "0"],
    ],
  };
  const [parsed] = parseRateSheet([sheet]);
  expect(parsed.card.mode).toBe("BARGE");
  expect(parsed.card.lane).toBe("NLRTM-DEDUI");
});
it("defaults mode to FCL when the Mode meta is absent (back-compat)", () => {
  const sheet = {
    name: "NLRTM-USNYC",
    rows: [
      ["Lane", "NLRTM-USNYC"], ["Version", "2026-06-v1"], ["Valid through", "2026-06-30"],
      ["Kind", "code", "container_type", "amount", "sort_order"],
      ["base", "BASE_40HC", "40HC", "2550", "0"],
    ],
  };
  expect(parseRateSheet([sheet])[0].card.mode).toBe("FCL");
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run packages/agents/src/parse-rate-sheet.test.ts -t Mode`
Expected: FAIL — `card.mode` is `undefined` (parser doesn't read `Mode`; `RateCardRow` got `mode` in Task 5 so this is now a real gap).

- [ ] **Step 4: Implement the parser change**

In `packages/agents/src/parse-rate-sheet.ts`: read a `Mode` meta row and default to `FCL`. In the meta loop (~line 41), add `"Mode"` to the captured labels:
```ts
      if (a === "Lane" || a === "Version" || a === "Valid through" || a === "Mode") {
        meta[a] = cellStr((sheet.rows[i] ?? [])[1]);
      }
```
At the `out.push(...)` (~line 96), include mode with an FCL default:
```ts
    out.push({ card: { mode: meta["Mode"] || "FCL", version, validity_through: validity, lane }, lines });
```

- [ ] **Step 5: Add the barge sheet to the generator + write mode on import**

In `scripts/gen_rate_sheet.ts`: it builds one worksheet per card from a list of card definitions, each emitting the meta rows (`Lane`/`Version`/`Valid through`) then the `Kind` header + lines. Add a `Mode` meta row to **every** sheet's meta output (value `"FCL"` for the existing lanes), and append a new BARGE card definition:
- meta: `Mode = BARGE`, `Lane = NLRTM-DEDUI`, `Version = 2026-06-v1`, `Valid through = 2026-06-30`
- lines: `base BASE_20GP 20GP 280 0` · `base BASE_40GP 40GP 420 1` · `base BASE_40HC 40HC 420 2` · `surcharge_per_container LWS "" 95 0` · `surcharge_per_container THC_RTM_BARGE "" 95 1` · `surcharge_per_container THC_DUI "" 110 2` · `per_shipment_fee DOC "" 35 0`

In `scripts/import_rate_sheet.ts`: add `mode` to the existence query and the upsert.
- In the `.from("rate_cards").select("id")...` block (line 23‑29), add `.eq("mode", card.mode)` before `.maybeSingle()`.
- In the `.upsert({...})` (line 33‑40), add `mode: card.mode,` after `tenant_id`.

- [ ] **Step 6: Regenerate the workbook + run the parser/round-trip tests**

Run: `npm run rates:gen && npx vitest run packages/agents/src/parse-rate-sheet.test.ts packages/agents/src/rate-sheet-roundtrip.test.ts`
Expected: workbook regenerates with the barge sheet; parser tests PASS; round‑trip PASS. (Do NOT run `npm run rates:import` here — that writes to live Supabase and is a supervised, separate step.)

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0013_rate_card_mode.sql packages/agents/src/parse-rate-sheet.ts packages/agents/src/parse-rate-sheet.test.ts scripts/gen_rate_sheet.ts scripts/import_rate_sheet.ts rates/linkport-rate-sheet.xlsx
git commit -m "feat(rates): rate sheet carries Mode; add barge NLRTM-DEDUI card; migration 0013"
```

---

### Task 8: Assumptions, decision log, full verification

**Files:**
- Modify: `docs/ASSUMPTIONS.md`, `docs/DECISION_LOG.md`

- [ ] **Step 1: Log the barge figures in `docs/ASSUMPTIONS.md`**

Add a new section (after the A′ block) — every line `INVENTED` with a verification path:
```markdown
## D. Barge mode (NLRTM → DEDUI, all INVENTED)

Lane Rotterdam (NLRTM) → Duisburg (DEDUI), inland Rhine barge, EUR, per container. Card `2026-06-v1`.

| # | Item | Value | Status | How to verify |
|---|------|-------|--------|---------------|
| D1 | Base 20GP | €280 / container | INVENTED | Rhine barge operator tariff (e.g. Contargo/Danser) / forwarder |
| D2 | Base 40GP / 40HC | €420 / container | INVENTED | as D1; verify 40' ≥ 20' |
| D3 | LWS (Low-Water Surcharge) | €95 / container | INVENTED | Confirm LWS exists, is VARIABLE with Rhine water level (we model a flat line), and rough magnitude |
| D4 | THC origin (Rotterdam barge terminal) | €95 / container | INVENTED | Rotterdam inland terminal tariff |
| D5 | THC destination (Duisburg) | €110 / container | INVENTED | Duisburg (duisport) terminal tariff |
| D6 | DOC (documentation) | €35 / shipment | INVENTED | forwarder |
```

- [ ] **Step 2: Add the decision-log entry**

Add to `docs/DECISION_LOG.md` (newest first, under a new dated section):
```markdown
## Multi-modal rate sheet — barge (2026-06-02)

- **D-30 · Transport mode is a first-class rate-card key; pricing dispatches on a mode→basis map.** ·
  `rate_cards.mode` (migration 0013); the active card resolves by (tenant, mode, lane); `priceQuote`
  + the gate dispatch on `MODE_BASIS` (FCL/BARGE/RAIL = per_container, implemented; AIR = per_chargeable_kg,
  TRUCK = per_ldm, reserved + refused until built). Barge NLRTM→DEDUI added (Low-Water Surcharge);
  all figures INVENTED (ASSUMPTIONS D). The gate validates against the engine-resolved card (via the new
  `RateEngine.cardFor`), removing the hardcoded FCL/single-lane check — which also unlocks the A′ lanes
  live. · *Extends D-04 (one mode/one lane); honours D-25 (Excel = source of truth). Air/truck pricing
  deferred — seam only (YAGNI).* · **Accepted.**
```

- [ ] **Step 3: Full offline verification**

Run: `npm test && npm run typecheck`
Expected: ALL pass (target ≥ prior 174 + the new tests), typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add docs/ASSUMPTIONS.md docs/DECISION_LOG.md
git commit -m "docs(rates): ASSUMPTIONS D (barge) + DECISION_LOG D-30 (multi-modal rate sheet)"
```

---

## Post-plan (supervised, separate — NOT part of the offline build)

These are live/infra steps to run only with explicit go (they touch live services), per the project's gate discipline:
1. Apply migration `0013` to live Supabase (`bash scripts/db.sh supabase/migrations/0013_rate_card_mode.sql`).
2. `npm run rates:import` to upsert the barge card (and re-stamp existing cards with `mode='FCL'`).
3. Gate-3 self-review + codex Gate-4 + AUDIT_LOG entry + sign-off before merging `feat/barge-rate-mode` → `main`.
4. Optional live proof: a barge request email → poll → quote → review.
