import { createClient } from "@supabase/supabase-js";
import { listRequestsForTenant } from "../apps/web/src/lib/dashboard.js";

/**
 * Live AC-5 end-to-end (npm run eval:web-ac5): the BROWSER path. Two real password users in two
 * tenants; each, via an anon client + a signed-in session, sees ONLY its own tenant's requests
 * through RLS — the same data-access the dashboard uses. Seeds + cleans up its own test users and
 * tenants (idempotent). Requires SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY.
 */

const url = process.env.SUPABASE_URL ?? "";
const anonKey = process.env.SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!url || !anonKey || !serviceKey) {
  console.error("SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const TA = "a1b2c3d4-0000-4000-8000-00000000000a";
const TB = "a1b2c3d4-0000-4000-8000-00000000000b";
const EMAIL_A = "ac5-web-a@test.local";
const EMAIL_B = "ac5-web-b@test.local";
const PW = "Test-AC5-pw-9f3a21";

async function deleteUserByEmail(email: string): Promise<void> {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const u = data.users.find((x) => x.email === email);
  if (u) await admin.auth.admin.deleteUser(u.id);
}

async function cleanup(): Promise<void> {
  await admin.from("quote_requests").delete().in("tenant_id", [TA, TB]); // cascades quotes + drafts
  await admin.from("profiles").delete().in("tenant_id", [TA, TB]);
  await admin.from("tenants").delete().in("id", [TA, TB]);
  await deleteUserByEmail(EMAIL_A);
  await deleteUserByEmail(EMAIL_B);
}

async function seedTenant(tenantId: string, email: string, name: string): Promise<string> {
  await admin.from("tenants").upsert({ id: tenantId, name });
  const { data: created, error } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true });
  if (error || !created.user) throw error ?? new Error("createUser failed");
  await admin.from("profiles").upsert({ user_id: created.user.id, tenant_id: tenantId });
  const { data: req, error: rErr } = await admin
    .from("quote_requests")
    .insert({ tenant_id: tenantId, source: "sample", subject: `req for ${name}`, status: "awaiting_review" })
    .select("id")
    .single();
  if (rErr) throw rErr;
  await admin.from("quotes").insert({
    request_id: req.id,
    tenant_id: tenantId,
    rate_card_version: "2026-06-v1",
    container_type: "40HC",
    container_qty: 1,
    all_in_total: 3520,
    breakdown_snapshot: { all_in_total: 3520 },
    validity_through: "2026-06-30",
  });
  await admin.from("drafts").insert({ request_id: req.id, tenant_id: tenantId, subject: "Re", body: "all-in EUR 3,520." });
  return req.id as string;
}

async function visibleAs(email: string): Promise<string[]> {
  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: PW });
  if (error) throw error;
  const views = await listRequestsForTenant(client);
  return views.map((v) => v.id);
}

async function main(): Promise<void> {
  await cleanup(); // idempotent start
  const reqA = await seedTenant(TA, EMAIL_A, "Tenant A");
  const reqB = await seedTenant(TB, EMAIL_B, "Tenant B");

  const seenByA = await visibleAs(EMAIL_A);
  const seenByB = await visibleAs(EMAIL_B);

  const aOk = seenByA.includes(reqA) && !seenByA.includes(reqB);
  const bOk = seenByB.includes(reqB) && !seenByB.includes(reqA);
  console.log(`A (anon+session) sees ${seenByA.length} request(s): ${aOk ? "PASS" : "FAIL"} (own only, not B)`);
  console.log(`B (anon+session) sees ${seenByB.length} request(s): ${bOk ? "PASS" : "FAIL"} (own only, not A)`);

  await cleanup();
  const pass = aOk && bOk;
  console.log(`\nAC-5 end-to-end (browser anon + RLS): ${pass ? "PASS" : "FAIL"}`);
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
