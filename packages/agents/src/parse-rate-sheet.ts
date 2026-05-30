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
