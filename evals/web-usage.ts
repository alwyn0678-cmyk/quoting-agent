import { createClient } from "@supabase/supabase-js";
import { listUsageForTenant } from "../apps/web/src/lib/usage.js";

/**
 * Live P-1C.6 (npm run eval:web-usage): the BROWSER path surfaces well-formed usage on BOTH the
 * quote and escalate paths (T13 parity), and audit_log is RLS-isolated to the caller's tenant.
 * Seeds tenant TI with a 'quote' and an 'escalate' audit row, and a SECOND tenant TO with its own
 * row; signs in as TI's user and asserts listUsageForTenant (the exact /usage read) returns only
 * TI's two rows — both well-formed — and never TO's. Idempotent seed + cleanup. Requires
 * SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY.
 */

const url = process.env.SUPABASE_URL ?? "";
const anonKey = process.env.SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!url || !anonKey || !serviceKey) {
  console.error("SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const TI = "e1f2a3b4-0000-4000-8000-00000000000a";
const TO = "e1f2a3b4-0000-4000-8000-00000000000b";
const EMAIL = "usage-demo@test.local";
const PW = "Test-USG-pw-2a8f44";
const TO_MARKER = 999; // input_tokens value only TO's row carries — must never be visible to TI

async function deleteUserByEmail(email: string): Promise<void> {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const u = data.users.find((x) => x.email === email);
  if (u) await admin.auth.admin.deleteUser(u.id);
}

async function cleanup(): Promise<void> {
  await admin.from("audit_log").delete().in("tenant_id", [TI, TO]);
  await admin.from("quote_requests").delete().in("tenant_id", [TI, TO]);
  await admin.from("profiles").delete().in("tenant_id", [TI, TO]);
  await admin.from("tenants").delete().in("id", [TI, TO]);
  await deleteUserByEmail(EMAIL);
}

async function main(): Promise<void> {
  await cleanup(); // idempotent start
  await admin.from("tenants").upsert([
    { id: TI, name: "Usage Tenant" },
    { id: TO, name: "Other Tenant" },
  ]);
  const { data: created, error } = await admin.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true });
  if (error || !created.user) throw error ?? new Error("createUser failed");
  await admin.from("profiles").upsert({ user_id: created.user.id, tenant_id: TI });

  await admin.from("audit_log").insert([
    {
      tenant_id: TI,
      event: "quote",
      model: "claude-sonnet-4-6 (extract), claude-haiku-4-5-20251001 (draft)",
      input_tokens: 1280,
      output_tokens: 360,
      est_cost_usd: 0.0462,
      injection_flag: false,
    },
    {
      tenant_id: TI,
      event: "escalate",
      model: "claude-sonnet-4-6 (extract)",
      input_tokens: 760,
      output_tokens: 110,
      est_cost_usd: 0.0196,
      injection_flag: false,
    },
    {
      tenant_id: TO, // another tenant's row — must stay invisible to TI
      event: "quote",
      model: "claude-sonnet-4-6 (extract)",
      input_tokens: TO_MARKER,
      output_tokens: 50,
      est_cost_usd: 0.9,
      injection_flag: false,
    },
  ]);

  // ── browser path: anon client + session, the exact /usage read ──
  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: sErr } = await client.auth.signInWithPassword({ email: EMAIL, password: PW });
  if (sErr) throw sErr;
  const view = await listUsageForTenant(client);

  const events = view.rows.map((r) => r.event).sort();
  const wellFormed = view.rows.every(
    (r) => typeof r.model === "string" && (r.model ?? "").length > 0 && r.input_tokens > 0 && r.output_tokens > 0 && r.est_cost_usd >= 0,
  );
  const isolated = view.rows.every((r) => r.input_tokens !== TO_MARKER); // never sees TO's row

  const bothPaths = events.length === 2 && events[0] === "escalate" && events[1] === "quote";
  const totalsOk = view.totals.runs === 2 && view.totals.input_tokens === 2040 && view.totals.output_tokens === 470;

  console.log(`rows=${view.rows.length} events=[${events.join(",")}] well-formed=${wellFormed} -> ${bothPaths && wellFormed ? "PASS" : "FAIL"} (T13 parity, both paths)`);
  console.log(`totals: runs=${view.totals.runs} in=${view.totals.input_tokens} out=${view.totals.output_tokens} cost=$${view.totals.est_cost_usd.toFixed(4)} -> ${totalsOk ? "PASS" : "FAIL"}`);
  console.log(`audit_log RLS isolation (TO row hidden): ${isolated ? "PASS" : "FAIL"}`);

  await cleanup();
  const pass = bothPaths && wellFormed && totalsOk && isolated;
  console.log(`\nP-1C.6 usage observability (browser): ${pass ? "PASS" : "FAIL"}`);
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
