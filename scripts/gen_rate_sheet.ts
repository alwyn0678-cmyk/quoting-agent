import ExcelJS from "exceljs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

// [kind, code, container, amount, sort] — every amount is an INVENTED placeholder (ASSUMPTIONS A / A').
type Line = [string, string, string, number, number];
interface LaneSpec {
  lane: string;
  mode: string;
  version: string;
  validity: string;
  lines: Line[];
}

// Valid through: today + 90 days (UTC), so a regenerated sheet is never born expired. The 90-day
// validity window is an INVENTED assumption (docs/ASSUMPTIONS.md) — a real forwarder sets its own.
const VALIDITY = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const LANES: LaneSpec[] = [
  {
    lane: "NLRTM-USNYC", // PARITY: must equal the seed / StaticCard exactly (A1-A9)
    mode: "FCL",
    version: "2026-06-v1",
    validity: VALIDITY,
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
    mode: "FCL",
    version: "2026-06-v1",
    validity: VALIDITY,
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
    mode: "FCL",
    version: "2026-06-v1",
    validity: VALIDITY,
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
  {
    lane: "NLRTM-DEDUI", // BARGE — Rotterdam -> Duisburg (Rhine). All figures INVENTED (ASSUMPTIONS D)
    mode: "BARGE",
    version: "2026-06-v1",
    validity: VALIDITY,
    lines: [
      ["base", "BASE_20GP", "20GP", 280, 0],
      ["base", "BASE_40GP", "40GP", 420, 1],
      ["base", "BASE_40HC", "40HC", 420, 2],
      ["surcharge_per_container", "LWS", "", 95, 0], // Low-Water Surcharge (Rhine)
      ["surcharge_per_container", "THC_RTM_BARGE", "", 95, 1],
      ["surcharge_per_container", "THC_DUI", "", 110, 2],
      ["per_shipment_fee", "DOC", "", 35, 0],
    ],
  },
];

async function main(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "QuoteAgent rates:gen";

  for (const L of LANES) {
    const ws = wb.addWorksheet(`${L.mode} ${L.lane}`);
    ws.addRow(["Mode", L.mode]);
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
