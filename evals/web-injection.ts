import { createClient } from "@supabase/supabase-js";
import { listRequestsForTenant } from "../apps/web/src/lib/dashboard.js";
import { StaticCardRateEngine } from "../packages/agents/src/rate-engine.js";

/**
 * Live AC-8 + fixture-07 parity (npm run eval:web-injection): the BROWSER path surfaces the
 * safe-state correctly. One tenant/user with two requests:
 *   (a) an ESCALATED request (out_of_scope_mode) — no quote, no draft: the dashboard shows the
 *       reason and offers no send action.
 *   (b) an injection-flagged but VALID quote — the fixture-07 outcome (quote-and-flag): injection_flag
 *       true, NO escalation_reason, the REAL engine price (EUR 3,520, not the injected EUR 1), with a
 *       quote + draft (still reviewable/approvable).
 * Asserts listRequestsForTenant (the exact dashboard read) surfaces both. Seeds + cleans up its own
 * tenant/user (idempotent). Requires SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY.
 */

const url = process.env.SUPABASE_URL ?? "";
const anonKey = process.env.SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!url || !anonKey || !serviceKey) {
  console.error("SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

/** supabase-js never throws — fail LOUDLY with context instead of ignoring a returned error. */
function must<T extends { error: unknown }>(res: T, what: string): T {
  if (res.error) throw new Error(`${what} failed: ${res.error instanceof Error ? res.error.message : JSON.stringify(res.error)}`);
  return res;
}

const TI = "d1e2f3a4-0000-4000-8000-00000000000a";
const EMAIL = "injection-demo@test.local";
const PW = "Test-INJ-pw-5b9d33";

async function deleteUserByEmail(email: string): Promise<void> {
  const { data } = must(await admin.auth.admin.listUsers({ page: 1, perPage: 200 }), "listUsers");
  const u = data.users.find((x) => x.email === email);
  if (u) must(await admin.auth.admin.deleteUser(u.id), `deleteUser ${email}`);
}

async function cleanup(): Promise<void> {
  must(await admin.from("quote_requests").delete().eq("tenant_id", TI), "cleanup quote_requests"); // cascades quotes + drafts
  must(await admin.from("profiles").delete().eq("tenant_id", TI), "cleanup profiles");
  must(await admin.from("tenants").delete().eq("id", TI), "cleanup tenants");
  await deleteUserByEmail(EMAIL);
}

async function main(): Promise<void> {
  await cleanup(); // idempotent start
  must(await admin.from("tenants").upsert({ id: TI, name: "Injection Demo" }), "seed tenant");
  const { data: created, error } = await admin.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true });
  if (error || !created.user) throw error ?? new Error("createUser failed");
  must(await admin.from("profiles").upsert({ user_id: created.user.id, tenant_id: TI }), "seed profile");

  // (a) escalated — out_of_scope_mode, no quote/draft
  const { data: esc, error: e1 } = await admin
    .from("quote_requests")
    .insert({ tenant_id: TI, source: "sample", subject: "LCL Rotterdam->NY?", status: "escalated", escalation_reason: "out_of_scope_mode" })
    .select("id")
    .single();
  if (e1) throw e1;

  // (b) injection-flagged valid quote — fixture-07 outcome: real engine price, quote-and-flag
  const quote = await new StaticCardRateEngine().price({
    origin_port_code: "NLRTM",
    destination_port_code: "USNYC",
    mode: "FCL",
    container_type: "40HC",
    container_qty: 1,
  });
  const { data: inj, error: e2 } = await admin
    .from("quote_requests")
    .insert({ tenant_id: TI, source: "sample", subject: "Quote 1x40HC RTM->NY", status: "awaiting_review", injection_flag: true })
    .select("id")
    .single();
  if (e2) throw e2;
  must(
    await admin.from("quotes").insert({
      request_id: inj.id,
      tenant_id: TI,
      rate_card_version: quote.rate_card_version,
      container_type: "40HC",
      container_qty: 1,
      all_in_total: quote.all_in_total,
      breakdown_snapshot: quote,
      validity_through: quote.validity_through,
    }),
    "seed quote",
  );
  must(await admin.from("drafts").insert({ request_id: inj.id, tenant_id: TI, subject: "Re", body: "all-in EUR 3,520." }), "seed draft");

  // ── browser path: anon client + session, the exact dashboard read ──
  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: sErr } = await client.auth.signInWithPassword({ email: EMAIL, password: PW });
  if (sErr) throw sErr;
  const views = await listRequestsForTenant(client);
  const escV = views.find((v) => v.id === esc.id);
  const injV = views.find((v) => v.id === inj.id);

  const escOk =
    escV?.status === "escalated" &&
    escV?.escalation_reason === "out_of_scope_mode" &&
    escV?.quote == null &&
    escV?.draft == null;
  const injOk =
    injV?.injection_flag === true &&
    injV?.escalation_reason == null &&
    injV?.quote?.all_in_total === 3520 &&
    injV?.draft != null;

  console.log(
    `escalated surfaced: status=${escV?.status}, reason=${escV?.escalation_reason}, quote=${escV?.quote ? "present" : "none"} -> ${escOk ? "PASS" : "FAIL"} (reason shown, no send)`,
  );
  console.log(
    `injection quote-and-flag: flag=${injV?.injection_flag}, reason=${injV?.escalation_reason ?? "null"}, total=${injV?.quote?.all_in_total} -> ${injOk ? "PASS" : "FAIL"} (real price, reviewable)`,
  );

  await cleanup();
  const pass = Boolean(escOk && injOk);
  console.log(`\nAC-8 + fixture-07 parity (browser surfacing): ${pass ? "PASS" : "FAIL"}`);
  process.exit(pass ? 0 : 1);
}

main().catch(async (e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  try {
    await cleanup();
  } catch {
    /* best effort */
  }
  process.exit(1);
});
