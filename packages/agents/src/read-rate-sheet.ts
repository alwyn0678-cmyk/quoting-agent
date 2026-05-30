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
