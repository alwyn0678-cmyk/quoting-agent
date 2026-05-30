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
