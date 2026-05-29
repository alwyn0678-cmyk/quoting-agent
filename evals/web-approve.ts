import { createClient } from "@supabase/supabase-js";
import { approveRequest } from "../apps/web/src/lib/approve.js";

/**
 * Live approve → simulated-send (npm run eval:web-approve): the BROWSER path. Two real password
 * users in two tenants, each with an awaiting_review request + draft. Signed in via an anon client +
 * session, the SAME approveRequest() the dashboard uses is exercised against live RLS + the
 * approve_request() RPC:
 *   - A approves its OWN request → status 'sent' + drafts.simulated_sent_at stamped (AC-6); the only
 *     call made is the RPC, never a send (AC-7 — there is no send method anywhere).
 *   - A attempts to approve B's request → REFUSED by the RPC's tenant check, and B is unchanged
 *     (P-APPROVE-AUTH).
 * Seeds + cleans up its own users/tenants (idempotent). Requires SUPABASE_URL + SUPABASE_ANON_KEY +
 * SUPABASE_SERVICE_ROLE_KEY.
 */

const url = process.env.SUPABASE_URL ?? "";
const anonKey = process.env.SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!url || !anonKey || !serviceKey) {
  console.error("SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const TA = "c1d2e3f4-0000-4000-8000-00000000000a";
const TB = "c1d2e3f4-0000-4000-8000-00000000000b";
const EMAIL_A = "approve-a@test.local";
const EMAIL_B = "approve-b@test.local";
const PW = "Test-APV-pw-7c4e22";

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
  await admin.from("drafts").insert({ request_id: req.id, tenant_id: tenantId, subject: "Re", body: "all-in EUR 3,520." });
  return req.id as string;
}

async function sessionFor(email: string) {
  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: PW });
  if (error) throw error;
  return client;
}

async function main(): Promise<void> {
  await cleanup(); // idempotent start
  const reqA = await seedTenant(TA, EMAIL_A, "Tenant A");
  const reqB = await seedTenant(TB, EMAIL_B, "Tenant B");

  const a = await sessionFor(EMAIL_A);

  // 1) A approves its OWN request → sent + simulated_sent_at (AC-6); approveRequest only calls the RPC (AC-7).
  await approveRequest(a, reqA);
  const { data: rA } = await a.from("quote_requests").select("status").eq("id", reqA).single();
  const { data: dA } = await a.from("drafts").select("simulated_sent_at").eq("request_id", reqA).single();
  const ownOk = rA?.status === "sent" && dA?.simulated_sent_at != null;
  console.log(
    `A approves own request: status=${rA?.status}, simulated_sent_at=${dA?.simulated_sent_at ? "set" : "null"} -> ${ownOk ? "PASS" : "FAIL"}`,
  );

  // 2) A attempts to approve B's request → must be REFUSED, and B must stay unchanged (P-APPROVE-AUTH).
  let crossRejected = false;
  try {
    await approveRequest(a, reqB);
  } catch {
    crossRejected = true;
  }
  const { data: rB } = await admin.from("quote_requests").select("status").eq("id", reqB).single();
  const { data: dB } = await admin.from("drafts").select("simulated_sent_at").eq("request_id", reqB).single();
  const crossOk = crossRejected && rB?.status === "awaiting_review" && dB?.simulated_sent_at == null;
  console.log(
    `A approves B's request: rejected=${crossRejected}, B.status=${rB?.status}, B.simulated_sent_at=${dB?.simulated_sent_at ? "set" : "null"} -> ${crossOk ? "PASS" : "FAIL"}`,
  );

  await cleanup();
  const pass = ownOk && crossOk;
  console.log(`\nAC-6 + AC-7 + P-APPROVE-AUTH (browser approve path): ${pass ? "PASS" : "FAIL"}`);
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
