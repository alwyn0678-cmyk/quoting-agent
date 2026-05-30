# Serious Excel Rate Sheet (Q2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a real, committed, multi-lane Excel rate sheet (`rates/linkport-rate-sheet.xlsx`) plus an offline importer that upserts it into Supabase, while extending the pricing engine to support a 4th container type (`45HC`).

**Architecture:** A typed generator script writes the workbook; a pure `parseRateSheet` (no exceljs) turns neutral cells into the existing `RateCardRow`/`RateCardLineRow` types; an exceljs reader bridges the `.xlsx` to that parser; an importer upserts the parsed cards into Supabase idempotently by `(tenant, lane, version)`. The demo lane `NLRTM-USNYC` is held byte-identical to the seed/StaticCard (parity proof); the two new lanes (`NLRTM-USLAX`, `DEHAM-USNYC`) carry the richness. Runtime pricing keeps reading Supabase, unchanged.

**Tech Stack:** TypeScript (NodeNext, strict, `noUncheckedIndexedAccess`), Zod, vitest, exceljs (new devDependency), `@supabase/supabase-js`, tsx for scripts.

**Spec:** [docs/superpowers/specs/2026-05-30-excel-rate-sheet-design.md](../specs/2026-05-30-excel-rate-sheet-design.md). Every figure is INVENTED (ASSUMPTIONS discipline).

---

## File Structure

| File | Responsibility | Typechecked? Tested? |
|---|---|---|
| `packages/agents/src/schemas.ts` (modify) | add `45HC` to the two container-type enums | yes / via schemas+engine tests |
| `packages/agents/src/rate-card.ts` (modify) | `base_per_container` → `Partial<Record<…\|"45HC">>` | yes |
| `packages/agents/src/rate-engine.ts` (modify) | guard a missing base → `out_of_scope_container` | yes / `rate-engine.test.ts` |
| `packages/agents/src/parse-rate-sheet.ts` (create) | PURE `parseRateSheet(RawSheet[]) → ParsedCard[]`, no exceljs | yes / `parse-rate-sheet.test.ts` |
| `packages/agents/src/read-rate-sheet.ts` (create) | exceljs `.xlsx → RawSheet[]` bridge (only exceljs in src) | yes / via round-trip test |
| `scripts/gen_rate_sheet.ts` (create) | typed lane spec → writes the `.xlsx` | no (tsx) |
| `scripts/import_rate_sheet.ts` (create) | `.xlsx → parseRateSheet → upsert Supabase` (idempotent) | no (tsx) |
| `rates/linkport-rate-sheet.xlsx` (create) | the committed deliverable workbook | n/a (binary artifact) |
| `docs/ASSUMPTIONS.md` (modify) | section A′ (new-lane figures) + C3 note (45HC) | n/a |
| `package.json` (modify) | exceljs devDep + `rates:gen` / `rates:import` scripts | n/a |

**Test placement note:** there is no root vitest config, so any `**/*.test.ts` under `packages/` is auto-discovered (node env, cwd = repo root). The round-trip test reads the committed `.xlsx` from `rates/` via a `process.cwd()`-relative path.

**exceljs confinement:** exceljs is imported ONLY by `read-rate-sheet.ts` and the two scripts. Do **not** re-export `read-rate-sheet` from any package index — the agent/CLI/web runtime must never pull exceljs into its bundle.

---

### Task 1: Engine extension — `45HC` as a 4th priceable container

**Files:**
- Modify: `packages/agents/src/schemas.ts:22-27`
- Modify: `packages/agents/src/rate-card.ts:14`
- Modify: `packages/agents/src/rate-engine.ts:65-69`
- Test: `packages/agents/src/rate-engine.test.ts` (append a describe block)

- [ ] **Step 1: Write the failing tests**

Append to `packages/agents/src/rate-engine.test.ts` (the file already imports `priceQuote`, `UnpriceableRequestError`, `type PriceRequest`, and defines `inScope`). Add a `RateCard` import at the top of the file's import list:

```ts
import type { RateCard } from "./rate-card.js";
```

Then append this block at end of file:

```ts
describe("Q2-AC-Q0 — engine extension: 45HC is a real priceable container", () => {
  // A card that DOES define a 45HC base (shape of the new NLRTM-USLAX lane).
  const uslaxCard: RateCard = {
    version: "2026-06-v1",
    validity_through: "2026-06-30",
    supported_lane: "NLRTM-USLAX",
    base_per_container: { "20GP": 2200, "40GP": 2900, "40HC": 3050, "45HC": 3250 },
    surcharges: [
      { code: "BAF", amount_per_container: 360 },
      { code: "CAF", amount_per_container: 140 },
      { code: "THC_RTM", amount_per_container: 225 },
      { code: "THC_LAX", amount_per_container: 310 },
      { code: "ISPS", amount_per_container: 25 },
      { code: "PSS", amount_per_container: 200 },
    ],
    per_shipment_fees: [
      { code: "DOC", amount: 65 },
      { code: "EXPORT_CUSTOMS", amount: 45 },
    ],
  };

  it("prices a 45HC on a card that defines a 45HC base", () => {
    const q = priceQuote(
      {
        origin_port_code: "NLRTM",
        destination_port_code: "USLAX",
        mode: "FCL",
        container_type: "45HC",
        container_qty: 1,
      },
      uslaxCard,
    );
    expect(q.container_type).toBe("45HC");
    expect(q.base_per_container).toBe(3250);
    // 3250 + (360+140+225+310+25+200) + (65+45) = 4620
    expect(q.all_in_total).toBe(4620);
  });

  it("refuses a 45HC on a card without a 45HC base (out_of_scope_container)", () => {
    // default RATE_CARD (NLRTM-USNYC) has no 45HC base
    const call = () => priceQuote(inScope({ container_type: "45HC" }));
    expect(call).toThrow(UnpriceableRequestError);
    try {
      call();
    } catch (e) {
      expect((e as UnpriceableRequestError).reason).toBe("out_of_scope_container");
    }
  });

  it("still prices the existing 3 types byte-identically (40HC×1 = 3520)", () => {
    expect(priceQuote(inScope({ container_type: "40HC", container_qty: 1 })).all_in_total).toBe(3520);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/agents/src/rate-engine.test.ts`
Expected: FAIL — the first test errors because `rateContainerTypeSchema` rejects `"45HC"` (so `priceQuote` throws `out_of_scope_container` instead of pricing), and TypeScript/vitest may also flag the `uslaxCard` literal's `45HC` key against the current 3-key Record.

- [ ] **Step 3: Add `45HC` to both container-type enums**

In `packages/agents/src/schemas.ts`, change lines 22-27:

```ts
/** What the extractor may report — includes UNKNOWN / absent. */
export const extractionContainerTypeSchema = z
  .enum(["20GP", "40GP", "40HC", "45HC", "UNKNOWN"])
  .nullable();

/** What the rate engine can actually price — the real supported set only. */
export const rateContainerTypeSchema = z.enum(["20GP", "40GP", "40HC", "45HC"]);
```

(The extraction prompt in `extraction.ts` is intentionally NOT changed — adding an enum option is backward-compatible and does not alter existing extraction goldens.)

- [ ] **Step 4: Make `base_per_container` a Partial of the 4 types**

In `packages/agents/src/rate-card.ts`, change line 14:

```ts
  base_per_container: Partial<Record<"20GP" | "40GP" | "40HC" | "45HC", number>>; // whole EUR; a card need not price every type
```

The existing `RATE_CARD` literal (3 keys) stays valid because the keys are now optional.

- [ ] **Step 5: Guard a missing base in `priceQuote`**

In `packages/agents/src/rate-engine.ts`, replace lines 65-69 (the block from `const containerType` through the `all_in_total` calculation):

```ts
  const containerType = parsedType.data;
  const base = card.base_per_container[containerType];
  if (base === undefined) {
    throw new UnpriceableRequestError(
      "out_of_scope_container",
      `container_type '${containerType}' is not priced on lane '${card.supported_lane}'`,
    );
  }
  const surchargeSum = card.surcharges.reduce((sum, s) => sum + s.amount_per_container, 0);
  const perShipmentSum = card.per_shipment_fees.reduce((sum, f) => sum + f.amount, 0);
  const all_in_total = req.container_qty * (base + surchargeSum) + perShipmentSum;
```

(With the `Partial` type, `card.base_per_container[containerType]` is now `number | undefined`; `noUncheckedIndexedAccess` forces this guard, which is the only behavioural addition. Existing 20GP/40GP/40HC pricing is unaffected — those bases are always present.)

- [ ] **Step 6: Run tests + typecheck to verify pass**

Run: `npx vitest run packages/agents/src/rate-engine.test.ts && npm run typecheck`
Expected: PASS (all rate-engine tests green, including the existing T4/T5/P-1A.2 blocks); typecheck clean.

- [ ] **Step 7: Run the full suite (no regression from the enum change)**

Run: `npm test`
Expected: PASS — all existing tests green (extraction, schemas, dashboard, evals, etc.).

- [ ] **Step 8: Commit**

```bash
git add packages/agents/src/schemas.ts packages/agents/src/rate-card.ts packages/agents/src/rate-engine.ts packages/agents/src/rate-engine.test.ts
git commit -m "feat(engine): support 45HC as a 4th priceable container (backward-compatible)

rateContainerTypeSchema + extractionContainerTypeSchema gain 45HC; RateCard.base_per_container
becomes Partial (a card need not price every type); priceQuote refuses a container with no base
(out_of_scope_container) rather than producing NaN. Existing 20GP/40GP/40HC pricing byte-identical.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Pure parser `parseRateSheet`

**Files:**
- Create: `packages/agents/src/parse-rate-sheet.ts`
- Test: `packages/agents/src/parse-rate-sheet.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/agents/src/parse-rate-sheet.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseRateSheet, type RawSheet } from "./parse-rate-sheet.js";

/** Build a well-formed lane sheet (mirrors the workbook layout) from a compact line list. */
function sheet(name: string, lane: string, lines: (string | number | null)[][]): RawSheet {
  return {
    name,
    rows: [
      ["Lane", lane],
      ["Version", "2026-06-v1"],
      ["Valid through", "2026-06-30"],
      [], // blank separator — the parser tolerates it
      ["Kind", "Code", "Container", "Amount (EUR)", "Sort"],
      ...lines,
    ],
  };
}

describe("Q2-AC-Q1 — parseRateSheet maps neutral cells to ParsedCard[]", () => {
  it("parses meta + all three line kinds, mapping a blank container to null", () => {
    const parsed = parseRateSheet([
      sheet("L1", "NLRTM-USNYC", [
        ["base", "BASE_40HC", "40HC", 2550, 2],
        ["surcharge_per_container", "BAF", null, 320, 0],
        ["per_shipment_fee", "DOC", null, 65, 0],
      ]),
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.card).toEqual({
      lane: "NLRTM-USNYC",
      version: "2026-06-v1",
      validity_through: "2026-06-30",
    });
    expect(parsed[0]?.lines).toEqual([
      { kind: "base", code: "BASE_40HC", container_type: "40HC", amount: 2550, sort_order: 2 },
      { kind: "surcharge_per_container", code: "BAF", container_type: null, amount: 320, sort_order: 0 },
      { kind: "per_shipment_fee", code: "DOC", container_type: null, amount: 65, sort_order: 0 },
    ]);
  });

  it("skips About/README tabs and returns one card per lane tab", () => {
    const parsed = parseRateSheet([
      { name: "About", rows: [["All figures are INVENTED — see docs/ASSUMPTIONS.md."]] },
      sheet("a", "NLRTM-USNYC", [["base", "BASE_20GP", "20GP", 1800, 0]]),
      sheet("b", "DEHAM-USNYC", [["base", "BASE_20GP", "20GP", 1900, 0]]),
    ]);
    expect(parsed.map((p) => p.card.lane)).toEqual(["NLRTM-USNYC", "DEHAM-USNYC"]);
  });
});

describe("Q2-AC-Q4 — parseRateSheet fails fast on a malformed sheet", () => {
  it("throws on an unknown kind", () => {
    expect(() =>
      parseRateSheet([sheet("bad", "NLRTM-USNYC", [["surcharge", "X", null, 10, 0]])]),
    ).toThrow(/unknown kind/i);
  });

  it("throws on a non-numeric amount", () => {
    expect(() =>
      parseRateSheet([sheet("bad", "NLRTM-USNYC", [["base", "BASE_20GP", "20GP", "free", 0]])]),
    ).toThrow(/invalid amount/i);
  });

  it("throws when the meta block is incomplete (no Version)", () => {
    const s: RawSheet = {
      name: "x",
      rows: [
        ["Lane", "NLRTM-USNYC"],
        ["Kind", "Code", "Container", "Amount (EUR)", "Sort"],
        ["base", "BASE_20GP", "20GP", 1800, 0],
      ],
    };
    expect(() => parseRateSheet([s])).toThrow(/missing/i);
  });

  it("throws when there is no header row", () => {
    const s: RawSheet = { name: "x", rows: [["Lane", "NLRTM-USNYC"], ["Version", "2026-06-v1"]] };
    expect(() => parseRateSheet([s])).toThrow(/header/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/agents/src/parse-rate-sheet.test.ts`
Expected: FAIL with "Cannot find module './parse-rate-sheet.js'" (the module does not exist yet).

- [ ] **Step 3: Write the parser**

Create `packages/agents/src/parse-rate-sheet.ts`:

```ts
import type { RateCardRow, RateCardLineRow } from "./rate-card-source.js";

/**
 * Pure parser: neutral spreadsheet cells -> the existing rate-card row types. Carries NO exceljs
 * dependency (the .xlsx -> RawSheet[] bridge lives in read-rate-sheet.ts), so it is trivially unit
 * tested. Fails fast: a malformed sheet throws rather than importing silently.
 */

export type RawCell = string | number | null | undefined;
export interface RawSheet {
  name: string;
  rows: RawCell[][];
}
export interface ParsedCard {
  card: RateCardRow;
  lines: RateCardLineRow[];
}

const KINDS = ["base", "surcharge_per_container", "per_shipment_fee"] as const;

function cellStr(c: RawCell): string {
  return c === null || c === undefined ? "" : String(c).trim();
}

export function parseRateSheet(sheets: RawSheet[]): ParsedCard[] {
  const out: ParsedCard[] = [];

  for (const sheet of sheets) {
    const lname = sheet.name.trim().toLowerCase();
    if (lname === "about" || lname === "readme") continue;

    // 1) meta block (labelled rows in column A) + locate the header row
    const meta: Record<string, string> = {};
    let headerIdx = -1;
    for (let i = 0; i < sheet.rows.length; i++) {
      const a = cellStr((sheet.rows[i] ?? [])[0]);
      if (a === "Kind") {
        headerIdx = i;
        break;
      }
      if (a === "Lane" || a === "Version" || a === "Valid through") {
        meta[a] = cellStr((sheet.rows[i] ?? [])[1]);
      }
    }
    if (headerIdx === -1) {
      throw new Error(`sheet '${sheet.name}': no header row (missing a 'Kind' column)`);
    }
    const lane = meta["Lane"];
    const version = meta["Version"];
    const validity = meta["Valid through"];
    if (!lane || !version || !validity) {
      throw new Error(`sheet '${sheet.name}': missing Lane / Version / Valid through meta`);
    }

    // 2) line rows until a blank row or end of data
    const lines: RateCardLineRow[] = [];
    for (let i = headerIdx + 1; i < sheet.rows.length; i++) {
      const row = sheet.rows[i] ?? [];
      const kindRaw = cellStr(row[0]);
      if (kindRaw === "") break;
      if (!(KINDS as readonly string[]).includes(kindRaw)) {
        throw new Error(`sheet '${sheet.name}' row ${i + 1}: unknown kind '${kindRaw}'`);
      }
      const code = cellStr(row[1]);
      if (code === "") throw new Error(`sheet '${sheet.name}' row ${i + 1}: empty code`);
      const containerStr = cellStr(row[2]);
      const amount = Number(row[3]);
      if (!Number.isFinite(amount) || amount < 0) {
        throw new Error(`sheet '${sheet.name}' row ${i + 1}: invalid amount '${cellStr(row[3])}'`);
      }
      const sort_order = Number(row[4]);
      if (!Number.isInteger(sort_order)) {
        throw new Error(`sheet '${sheet.name}' row ${i + 1}: invalid sort '${cellStr(row[4])}'`);
      }
      lines.push({
        kind: kindRaw as RateCardLineRow["kind"],
        code,
        container_type: containerStr === "" ? null : containerStr,
        amount,
        sort_order,
      });
    }
    if (lines.length === 0) throw new Error(`sheet '${sheet.name}': no line rows`);

    out.push({ card: { version, validity_through: validity, lane }, lines });
  }

  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/agents/src/parse-rate-sheet.test.ts && npm run typecheck`
Expected: PASS — all AC-Q1 / AC-Q4 cases green; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/parse-rate-sheet.ts packages/agents/src/parse-rate-sheet.test.ts
git commit -m "feat(rates): pure parseRateSheet (neutral cells -> rate-card rows), fail-fast

Carries no exceljs dependency; returns the existing RateCardRow/RateCardLineRow types. Unit-tested
for meta extraction, all three line kinds, blank-container->null, and fail-fast on unknown kind /
bad amount / incomplete meta / missing header.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Generator script + the committed `.xlsx`

**Files:**
- Modify: `package.json` (devDependency + script)
- Create: `scripts/gen_rate_sheet.ts`
- Create: `rates/linkport-rate-sheet.xlsx` (generated, committed)

- [ ] **Step 1: Add exceljs as a devDependency**

Run: `npm install --save-dev exceljs`
Expected: `package.json` gains `"exceljs": "^4.x"` under `devDependencies`; `package-lock.json` updates.

- [ ] **Step 2: Add the `rates:gen` script**

In `package.json` `scripts`, add (next to `graph:smoke`):

```json
    "rates:gen": "node --env-file-if-exists=.env --import tsx scripts/gen_rate_sheet.ts",
```

- [ ] **Step 3: Write the generator**

Create `scripts/gen_rate_sheet.ts` (run via tsx; not root-typechecked). The lane figures below are the canonical source for the workbook — ALL INVENTED (see docs/ASSUMPTIONS.md):

```ts
import ExcelJS from "exceljs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

// [kind, code, container, amount, sort] — every amount is an INVENTED placeholder (ASSUMPTIONS A / A').
type Line = [string, string, string, number, number];
interface LaneSpec {
  lane: string;
  version: string;
  validity: string;
  lines: Line[];
}

const LANES: LaneSpec[] = [
  {
    lane: "NLRTM-USNYC", // PARITY: must equal the seed / StaticCard exactly (A1-A9)
    version: "2026-06-v1",
    validity: "2026-06-30",
    lines: [
      ["base", "BASE_20GP", "20GP", 1800, 0],
      ["base", "BASE_40GP", "40GP", 2400, 1],
      ["base", "BASE_40HC", "40HC", 2550, 2],
      ["surcharge_per_container", "BAF", "", 320, 0],
      ["surcharge_per_container", "THC_RTM", "", 225, 1],
      ["surcharge_per_container", "THC_NYC", "", 290, 2],
      ["surcharge_per_container", "ISPS", "", 25, 3],
      ["per_shipment_fee", "DOC", "", 65, 0],
      ["per_shipment_fee", "EXPORT_CUSTOMS", "", 45, 1],
    ],
  },
  {
    lane: "NLRTM-USLAX", // NEW richer lane (Rotterdam -> Los Angeles); adds 45HC, CAF, PSS
    version: "2026-06-v1",
    validity: "2026-06-30",
    lines: [
      ["base", "BASE_20GP", "20GP", 2200, 0],
      ["base", "BASE_40GP", "40GP", 2900, 1],
      ["base", "BASE_40HC", "40HC", 3050, 2],
      ["base", "BASE_45HC", "45HC", 3250, 3],
      ["surcharge_per_container", "BAF", "", 360, 0],
      ["surcharge_per_container", "CAF", "", 140, 1],
      ["surcharge_per_container", "THC_RTM", "", 225, 2],
      ["surcharge_per_container", "THC_LAX", "", 310, 3],
      ["surcharge_per_container", "ISPS", "", 25, 4],
      ["surcharge_per_container", "PSS", "", 200, 5],
      ["per_shipment_fee", "DOC", "", 65, 0],
      ["per_shipment_fee", "EXPORT_CUSTOMS", "", 45, 1],
    ],
  },
  {
    lane: "DEHAM-USNYC", // NEW richer lane (Hamburg -> New York); adds 45HC, CONGESTION
    version: "2026-06-v1",
    validity: "2026-06-30",
    lines: [
      ["base", "BASE_20GP", "20GP", 1900, 0],
      ["base", "BASE_40GP", "40GP", 2500, 1],
      ["base", "BASE_40HC", "40HC", 2650, 2],
      ["base", "BASE_45HC", "45HC", 2850, 3],
      ["surcharge_per_container", "BAF", "", 330, 0],
      ["surcharge_per_container", "THC_HAM", "", 240, 1],
      ["surcharge_per_container", "THC_NYC", "", 290, 2],
      ["surcharge_per_container", "ISPS", "", 25, 3],
      ["surcharge_per_container", "CONGESTION", "", 175, 4],
      ["per_shipment_fee", "DOC", "", 65, 0],
      ["per_shipment_fee", "EXPORT_CUSTOMS", "", 45, 1],
    ],
  },
];

async function main(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "QuoteAgent rates:gen";

  for (const L of LANES) {
    const ws = wb.addWorksheet(L.lane);
    ws.addRow(["Lane", L.lane]);
    ws.addRow(["Version", L.version]);
    ws.addRow(["Valid through", L.validity]);
    ws.addRow([]);
    const header = ws.addRow(["Kind", "Code", "Container", "Amount (EUR)", "Sort"]);
    header.font = { bold: true };
    for (const [kind, code, container, amount, sort] of L.lines) {
      ws.addRow([kind, code, container, amount, sort]);
    }
    ws.columns.forEach((c) => {
      c.width = 24;
    });
  }

  const about = wb.addWorksheet("About");
  about.addRow([
    "All figures are INVENTED placeholders — see docs/ASSUMPTIONS.md. Not real freight rates.",
  ]);
  about.addRow([
    "A real forwarder replaces these with their contracted rates, then runs `npm run rates:import`.",
  ]);

  mkdirSync(resolve(process.cwd(), "rates"), { recursive: true });
  const outPath = resolve(process.cwd(), "rates/linkport-rate-sheet.xlsx");
  await wb.xlsx.writeFile(outPath);
  console.log(`wrote ${outPath} (${LANES.length} lanes + About)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 4: Generate the workbook**

Run: `npm run rates:gen`
Expected: stdout `wrote …/rates/linkport-rate-sheet.xlsx (3 lanes + About)`; the file exists.

- [ ] **Step 5: Sanity-check the file is a real .xlsx**

Run: `file rates/linkport-rate-sheet.xlsx`
Expected: reports a Zip/OOXML/Excel document (an `.xlsx` is a zip container), e.g. "Microsoft Excel 2007+" or "Zip archive data".

- [ ] **Step 6: Commit (the script, the dep bump, and the artifact)**

```bash
git add package.json package-lock.json scripts/gen_rate_sheet.ts rates/linkport-rate-sheet.xlsx
git commit -m "feat(rates): exceljs generator + committed linkport-rate-sheet.xlsx (3 lanes)

Typed lane spec -> real .xlsx (one tab per lane + an About tab). NLRTM-USNYC held at parity;
NLRTM-USLAX and DEHAM-USNYC are the new richer lanes. All figures INVENTED.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: exceljs reader + round-trip test (parity + 45HC pricing on the real artifact)

**Files:**
- Create: `packages/agents/src/read-rate-sheet.ts`
- Test: `packages/agents/src/rate-sheet-roundtrip.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/agents/src/rate-sheet-roundtrip.test.ts`. It reads the COMMITTED workbook and proves the Excel→card path reproduces the proven NLRTM-USNYC card (AC-Q2) and prices a 45HC on NLRTM-USLAX (AC-Q3):

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { resolve } from "node:path";
import { readRateSheetWorkbook } from "./read-rate-sheet.js";
import { parseRateSheet, type ParsedCard } from "./parse-rate-sheet.js";
import { assembleRateCard } from "./rate-card-source.js";
import { priceQuote, type PriceRequest } from "./rate-engine.js";
import { RATE_CARD } from "./rate-card.js";

const SHEET = resolve(process.cwd(), "rates/linkport-rate-sheet.xlsx");

describe("Q2 round-trip — the committed workbook parses + prices correctly", () => {
  let cards: ParsedCard[];
  beforeAll(async () => {
    cards = parseRateSheet(await readRateSheetWorkbook(SHEET));
  });

  const find = (lane: string) => cards.find((c) => c.card.lane === lane);

  it("contains all three lanes", () => {
    expect(cards.map((c) => c.card.lane).sort()).toEqual(["DEHAM-USNYC", "NLRTM-USLAX", "NLRTM-USNYC"]);
  });

  it("AC-Q2 parity: NLRTM-USNYC assembles to the StaticCard exactly", () => {
    const nyc = find("NLRTM-USNYC");
    expect(nyc).toBeDefined();
    expect(assembleRateCard(nyc!.card, nyc!.lines)).toEqual(RATE_CARD);
  });

  it("AC-Q2 parity: NLRTM-USNYC prices the proven demo totals", () => {
    const card = assembleRateCard(find("NLRTM-USNYC")!.card, find("NLRTM-USNYC")!.lines);
    const req = (over: Partial<PriceRequest>): PriceRequest => ({
      origin_port_code: "NLRTM",
      destination_port_code: "USNYC",
      mode: "FCL",
      container_type: "40HC",
      container_qty: 1,
      ...over,
    });
    expect(priceQuote(req({ container_type: "40HC", container_qty: 2 }), card).all_in_total).toBe(6930);
    expect(priceQuote(req({ container_type: "20GP", container_qty: 1 }), card).all_in_total).toBe(2770);
    expect(priceQuote(req({ container_type: "40HC", container_qty: 1 }), card).all_in_total).toBe(3520);
    expect(priceQuote(req({ container_type: "40GP", container_qty: 3 }), card).all_in_total).toBe(9890);
  });

  it("AC-Q3: NLRTM-USLAX prices a 45HC through the real engine", () => {
    const card = assembleRateCard(find("NLRTM-USLAX")!.card, find("NLRTM-USLAX")!.lines);
    const q = priceQuote(
      {
        origin_port_code: "NLRTM",
        destination_port_code: "USLAX",
        mode: "FCL",
        container_type: "45HC",
        container_qty: 1,
      },
      card,
    );
    expect(q.all_in_total).toBe(4620); // 3250 + 1260 surcharges + 110 fees
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/agents/src/rate-sheet-roundtrip.test.ts`
Expected: FAIL with "Cannot find module './read-rate-sheet.js'".

- [ ] **Step 3: Write the exceljs reader**

Create `packages/agents/src/read-rate-sheet.ts`:

```ts
import ExcelJS from "exceljs";
import type { RawCell, RawSheet } from "./parse-rate-sheet.js";

/**
 * Bridge an .xlsx rate sheet into the neutral RawSheet[] the pure parser consumes. exceljs is
 * confined to THIS module + the gen/import scripts; the agent/CLI/web runtime never imports it, so
 * exceljs is never bundled into the app. Do not re-export this from any package index.
 */
export async function readRateSheetWorkbook(path: string): Promise<RawSheet[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const sheets: RawSheet[] = [];
  wb.eachSheet((ws) => {
    const rows: RawCell[][] = [];
    ws.eachRow((row) => {
      // exceljs row.values is 1-indexed (index 0 is empty); drop it to get 0-indexed cells.
      const values = row.values as unknown as RawCell[];
      rows.push(values.slice(1));
    });
    sheets.push({ name: ws.name, rows });
  });
  return sheets;
}
```

- [ ] **Step 4: Run the test + typecheck to verify pass**

Run: `npx vitest run packages/agents/src/rate-sheet-roundtrip.test.ts && npm run typecheck`
Expected: PASS — parity holds (`assembleRateCard(...) === RATE_CARD`), all four NYC totals match, and the USLAX 45HC prices to 4620; typecheck clean.

> If `npm run typecheck` reports it cannot find exceljs's types under NodeNext, confirm exceljs is installed (it ships its own `.d.ts`); `skipLibCheck` + `esModuleInterop` are already enabled, so `import ExcelJS from "exceljs"` is correct. Do NOT install `@types/exceljs` (it is a stub for the bundled types).

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/read-rate-sheet.ts packages/agents/src/rate-sheet-roundtrip.test.ts
git commit -m "test(rates): round-trip the committed .xlsx — NLRTM-USNYC parity + USLAX 45HC pricing

read-rate-sheet.ts bridges .xlsx -> RawSheet[] (exceljs confined here). The round-trip test proves
the real workbook assembles NLRTM-USNYC to the StaticCard exactly (6930/2770/3520/9890) and prices a
45HC on NLRTM-USLAX to 4620 through the real engine.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Importer script (idempotent upsert to Supabase) — live run deferred

**Files:**
- Modify: `package.json` (script)
- Create: `scripts/import_rate_sheet.ts`

- [ ] **Step 1: Add the `rates:import` script**

In `package.json` `scripts`, add (next to `rates:gen`):

```json
    "rates:import": "node --env-file-if-exists=.env --import tsx scripts/import_rate_sheet.ts",
```

- [ ] **Step 2: Write the importer**

Create `scripts/import_rate_sheet.ts` (run via tsx; not root-typechecked). It reuses the tested `parseRateSheet` + `readRateSheetWorkbook`, and upserts idempotently by `(tenant_id, lane, version)`:

```ts
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { readRateSheetWorkbook } from "../packages/agents/src/read-rate-sheet.js";
import { parseRateSheet } from "../packages/agents/src/parse-rate-sheet.js";

// Linkport Forwarders BV (the seeded tenant). A forwarder owns many lanes under one tenant.
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const SHEET_PATH = resolve(process.cwd(), "rates/linkport-rate-sheet.xlsx");

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required (server-side, service_role)");
  }
  const db = createClient(url, key);

  const cards = parseRateSheet(await readRateSheetWorkbook(SHEET_PATH));
  for (const { card, lines } of cards) {
    // Idempotent by natural key: reuse the existing card's id so references (e.g. the seeded
    // NLRTM-USNYC card) stay valid; otherwise mint a fresh uuid.
    const { data: existing, error: selErr } = await db
      .from("rate_cards")
      .select("id")
      .eq("tenant_id", TENANT_ID)
      .eq("lane", card.lane)
      .eq("version", card.version)
      .maybeSingle();
    if (selErr) throw selErr;

    const id: string = existing?.id ?? randomUUID();
    const { error: upErr } = await db.from("rate_cards").upsert({
      id,
      tenant_id: TENANT_ID,
      lane: card.lane,
      version: card.version,
      validity_through: card.validity_through,
      is_active: true,
    });
    if (upErr) throw upErr;

    // Replace this card's lines (same pattern as the SQL seed) so re-runs are idempotent.
    const { error: delErr } = await db.from("rate_card_lines").delete().eq("rate_card_id", id);
    if (delErr) throw delErr;
    const { error: insErr } = await db.from("rate_card_lines").insert(
      lines.map((l) => ({
        rate_card_id: id,
        kind: l.kind,
        code: l.code,
        container_type: l.container_type,
        amount: l.amount,
        sort_order: l.sort_order,
      })),
    );
    if (insErr) throw insErr;

    console.log(`imported ${card.lane} ${card.version}: ${lines.length} lines (card ${id})`);
  }
  console.log(`done: ${cards.length} cards upserted`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: Verify the importer module loads (no live DB call) and typecheck is unaffected**

Run: `npm run typecheck`
Expected: PASS — `scripts/**` is not root-typechecked, and the new script does not change any typechecked module.

> The **live import run** (`npm run rates:import` against Supabase) is deliberately deferred to the end-of-project live-test batch (per the "complete the project, live tests at the end" directive). Its correctness rests on the already-tested `parseRateSheet` + `readRateSheetWorkbook`; the idempotent natural-key upsert is verified live then. Do NOT run it against Supabase in this task.

- [ ] **Step 4: Commit**

```bash
git add package.json scripts/import_rate_sheet.ts
git commit -m "feat(rates): import_rate_sheet — idempotent .xlsx -> Supabase upsert (live run deferred)

Reuses the tested parseRateSheet + readRateSheetWorkbook; upserts rate_cards/rate_card_lines
idempotently by (tenant_id, lane, version), reusing an existing card's id (so the seeded
NLRTM-USNYC card is updated in place, not duplicated). Live run batched with end-of-project tests.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: ASSUMPTIONS.md — log the new-lane figures (section A′) + the 45HC note

**Files:**
- Modify: `docs/ASSUMPTIONS.md`

- [ ] **Step 1: Append section A′ after the existing section A (before "## B. Pricing structure")**

Insert this block immediately before the `## B. Pricing structure` heading in `docs/ASSUMPTIONS.md`:

```markdown
## A′. Additional lanes (all INVENTED — the serious mock rate sheet, Q2)

Two extra lanes added to `rates/linkport-rate-sheet.xlsx` so the workbook is a realistic multi-lane
sheet. Every figure is INVENTED; a real forwarder substitutes their contracted rates and re-imports.
Rate-card version `2026-06-v1`, `validity_through = 2026-06-30`, currency EUR.

**Lane NLRTM → USLAX (Rotterdam → Los Angeles), FCL ocean:**

| # | Claim | Value | Source | How to verify |
|---|---|---|---|---|
| A10 | Base 20GP | €2,200 / container | INVENTED | as A1 (Freightos/Drewry/Xeneta N. Europe→US West Coast; forwarder) |
| A11 | Base 40GP | €2,900 / container | INVENTED | as A10 |
| A12 | Base 40HC | €3,050 / container | INVENTED | as A10 |
| A13 | Base 45HC | €3,250 / container | INVENTED | as A10; also verify 45HC ≥ 40HC |
| A14 | BAF | €360 / container | INVENTED | as A4 |
| A15 | CAF (Currency Adjustment Factor) | €140 / container | INVENTED | Confirm CAF exists & magnitude with a forwarder/carrier tariff |
| A16 | THC origin (Rotterdam) | €225 / container | INVENTED | as A5 |
| A17 | THC destination (Los Angeles) | €310 / container | INVENTED | US West Coast terminal tariffs; forwarder |
| A18 | ISPS / security | €25 / container | INVENTED | as A7 |
| A19 | PSS (Peak Season Surcharge) | €200 / container | INVENTED | Confirm PSS applicability/season & magnitude |
| A20 | Documentation / B/L fee | €65 / shipment | INVENTED | as A8 |
| A21 | Export customs handling | €45 / shipment | INVENTED | as A9 |

**Lane DEHAM → USNYC (Hamburg → New York), FCL ocean:**

| # | Claim | Value | Source | How to verify |
|---|---|---|---|---|
| A22 | Base 20GP | €1,900 / container | INVENTED | as A1 |
| A23 | Base 40GP | €2,500 / container | INVENTED | as A22 |
| A24 | Base 40HC | €2,650 / container | INVENTED | as A22 |
| A25 | Base 45HC | €2,850 / container | INVENTED | as A22; verify 45HC ≥ 40HC |
| A26 | BAF | €330 / container | INVENTED | as A4 |
| A27 | THC origin (Hamburg) | €240 / container | INVENTED | Hamburg terminal tariffs; forwarder |
| A28 | THC destination (New York) | €290 / container | INVENTED | as A6 |
| A29 | ISPS / security | €25 / container | INVENTED | as A7 |
| A30 | CONGESTION surcharge | €175 / container | INVENTED | Confirm a port-congestion surcharge applies & magnitude |
| A31 | Documentation / B/L fee | €65 / shipment | INVENTED | as A8 |
| A32 | Export customs handling | €45 / shipment | INVENTED | as A9 |

Derived check (given the invented inputs): NLRTM→USLAX 45HC×1 = €4,620 (used as the AC-Q3 expected
value). Not a real quote.
```

- [ ] **Step 2: Update C3 to record the new container type**

In `docs/ASSUMPTIONS.md`, change the C3 row from:

```markdown
| C3 | Container types of interest are 20GP, 40GP, 40HC | STRUCTURAL | Reasonable for trans-Atlantic FCL; confirm 40HC dominance |
```

to:

```markdown
| C3 | Container types of interest are 20GP, 40GP, 40HC, and 45HC (45HC added in Q2 for the new lanes; the demo NLRTM→USNYC lane prices only the first three) | STRUCTURAL | Reasonable for trans-Atlantic/Pacific FCL; confirm 40HC/45HC usage |
```

- [ ] **Step 3: Verify the doc is internally consistent (no contradiction with the unchanged A1-A9)**

Run: `grep -n "45HC\|A10\|A32\|4,620" docs/ASSUMPTIONS.md`
Expected: the new A′ rows + the 45HC C3 note are present; A1-A9 and the original totals line are unchanged.

- [ ] **Step 4: Commit**

```bash
git add docs/ASSUMPTIONS.md
git commit -m "docs(assumptions): log new-lane figures (A') + 45HC container type (C3)

NLRTM-USLAX and DEHAM-USNYC figures recorded as INVENTED placeholders with verification paths; C3
notes 45HC was added in Q2. A1-A9 and the original totals unchanged (parity).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Final verification + hand to the audit gate

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: PASS — no errors across `packages`, `apps`, `evals`.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: PASS — every test green, including the new AC-Q0/Q1/Q2/Q3/Q4 and all pre-existing tests (no regression from the enum/Partial change).

- [ ] **Step 3: Confirm the web app still typechecks (apps/web has its own tsconfig; unaffected but verify)**

Run: `npm --prefix apps/web run typecheck`
Expected: PASS — `apps/web` is untouched by this work; this confirms no accidental coupling.

- [ ] **Step 4: Hand off to the audit gate (do NOT self-merge)**

Per the project's audit-gate discipline (memory: audit-gate-discipline): run Gate-3 (self review of `git diff main...HEAD`), then Gate-4 (`codex exec -s read-only --skip-git-repo-check` over the diff), reconcile findings, update `docs/AUDIT_LOG.md` + `DECISION_LOG`, then ask the user for sign-off before `git merge --no-ff` into `main`. Stop here and request the gate.

---

## Self-Review

**1. Spec coverage:**
- Real `.xlsx` via exceljs → Task 3. ✓
- Excel → import → Supabase (importer, idempotent natural-key upsert, reuse seeded card id) → Task 5. ✓
- Pure `parseRateSheet` returning existing row types, exceljs-free, unit-tested → Task 2. ✓
- Parity (NLRTM-USNYC byte-identical; `assembleRateCard === RATE_CARD`; 6930/2770/3520/9890) → AC-Q2, Task 4. ✓
- Two new richer lanes (USLAX, DEHAM) with the spec's exact figures → Task 3 (gen) + Task 6 (ASSUMPTIONS). ✓
- 45HC engine extension (the spec's amended "Engine extension" section: both enums + Partial base + guard) → Task 1, AC-Q0. ✓
- New surcharge codes price with no engine change → exercised by AC-Q3 (CAF/PSS in the USLAX total) + AC-Q0. ✓
- Fail-fast parser → AC-Q4, Task 2. ✓
- ASSUMPTIONS A′ + C3 → Task 6. ✓
- Distinct from the gated ExcelOnlineRateEngine (untouched) → no task modifies `excel-rate-card.ts`. ✓
- Live import deferred → Task 5 Step 3 note + Task 7 hand-off. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step shows the exact command + expected result. ✓

**3. Type consistency:** `RawCell`/`RawSheet`/`ParsedCard` are defined in Task 2 and imported unchanged by Tasks 4 & 5; `parseRateSheet`, `readRateSheetWorkbook`, `assembleRateCard`, `priceQuote`, `RATE_CARD` signatures match their source files; `RateCardRow`/`RateCardLineRow` reused verbatim from `rate-card-source.ts`; the `45HC` enum value + `Partial` base type introduced in Task 1 are relied on consistently by Tasks 3-5. ✓
