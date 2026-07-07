import { createClient } from "@supabase/supabase-js";
import { approveRequest } from "../apps/web/src/lib/approve.js";

/**
 * Live approve → real-send OUTBOX (npm run eval:web-approve): the BROWSER path. Two real password
 * users in two tenants, each with an awaiting_review request + draft. Signed in via an anon client +
 * session, the SAME approveRequest() the dashboard uses is exercised against live RLS + the RPCs (D-27):
 *   - A approves its OWN request → CLAIMS it to 'sending' (no real send yet, no drafts.sent_at); the
 *     only call made is the RPC, never a send (the dashboard holds no Graph creds).
 *   - finalize_send is service_role-ONLY: A (authenticated) CANNOT call it, so the real-send record is
 *     non-forgeable; the trusted worker (admin / service_role) finalizes → 'sent' + real drafts.sent_at.
 *   - A attempts to approve B's request → REFUSED by the RPC's tenant check, B unchanged (P-APPROVE-AUTH).
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

/** supabase-js never throws — fail LOUDLY with context instead of ignoring a returned error. */
function must<T extends { error: unknown }>(res: T, what: string): T {
  if (res.error) throw new Error(`${what} failed: ${res.error instanceof Error ? res.error.message : JSON.stringify(res.error)}`);
  return res;
}

const TA = "c1d2e3f4-0000-4000-8000-00000000000a";
const TB = "c1d2e3f4-0000-4000-8000-00000000000b";
const EMAIL_A = "approve-a@test.local";
const EMAIL_B = "approve-b@test.local";
const PW = "Test-APV-pw-7c4e22";

async function deleteUserByEmail(email: string): Promise<void> {
  const { data } = must(await admin.auth.admin.listUsers({ page: 1, perPage: 200 }), "listUsers");
  const u = data.users.find((x) => x.email === email);
  if (u) must(await admin.auth.admin.deleteUser(u.id), `deleteUser ${email}`);
}

async function cleanup(): Promise<void> {
  must(await admin.from("quote_requests").delete().in("tenant_id", [TA, TB]), "cleanup quote_requests"); // cascades quotes + drafts
  must(await admin.from("profiles").delete().in("tenant_id", [TA, TB]), "cleanup profiles");
  must(await admin.from("tenants").delete().in("id", [TA, TB]), "cleanup tenants");
  await deleteUserByEmail(EMAIL_A);
  await deleteUserByEmail(EMAIL_B);
}

async function seedTenant(tenantId: string, email: string, name: string): Promise<string> {
  must(await admin.from("tenants").upsert({ id: tenantId, name }), `seed tenant ${name}`);
  const { data: created, error } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true });
  if (error || !created.user) throw error ?? new Error("createUser failed");
  must(await admin.from("profiles").upsert({ user_id: created.user.id, tenant_id: tenantId }), `seed profile ${email}`);
  const { data: req, error: rErr } = await admin
    .from("quote_requests")
    .insert({ tenant_id: tenantId, source: "sample", subject: `req for ${name}`, status: "awaiting_review" })
    .select("id")
    .single();
  if (rErr) throw rErr;
  must(await admin.from("drafts").insert({ request_id: req.id, tenant_id: tenantId, subject: "Re", body: "all-in EUR 3,520." }), `seed draft for ${name}`);
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

  // 1) A approves its OWN request → CLAIMS it to 'sending' (D-27 outbox; no real send yet, no sent_at).
  await approveRequest(a, reqA);
  const { data: rA1 } = await a.from("quote_requests").select("status").eq("id", reqA).single();
  const { data: dA1 } = await a.from("drafts").select("sent_at").eq("request_id", reqA).single();
  const claimedOk = rA1?.status === "sending" && dA1?.sent_at == null;
  console.log(
    `A approves own request: status=${rA1?.status}, sent_at=${dA1?.sent_at ? "set" : "null"} -> ${claimedOk ? "PASS (claimed for send)" : "FAIL"}`,
  );

  // 1b) finalize_send is service_role-ONLY → an authenticated reviewer cannot forge a real send.
  const { error: forgeErr } = await a.rpc("finalize_send", { p_request_id: reqA, p_tenant_id: TA, p_ok: true });
  const forgeBlocked = Boolean(forgeErr);
  console.log(`A (authenticated) cannot call finalize_send: blocked=${forgeBlocked} -> ${forgeBlocked ? "PASS" : "FAIL"}`);

  // 1c) the trusted worker (service_role) finalizes → 'sent' + real drafts.sent_at.
  const { error: finErr } = await admin.rpc("finalize_send", { p_request_id: reqA, p_tenant_id: TA, p_ok: true });
  if (finErr) throw finErr;
  const { data: rA2 } = await admin.from("quote_requests").select("status").eq("id", reqA).single();
  const { data: dA2 } = await admin.from("drafts").select("sent_at").eq("request_id", reqA).single();
  const sentOk = rA2?.status === "sent" && dA2?.sent_at != null;
  console.log(
    `finalize_send (service_role): status=${rA2?.status}, sent_at=${dA2?.sent_at ? "set" : "null"} -> ${sentOk ? "PASS" : "FAIL"}`,
  );

  // 2) A attempts to approve B's request → must be REFUSED, and B must stay unchanged (P-APPROVE-AUTH).
  let crossRejected = false;
  try {
    await approveRequest(a, reqB);
  } catch {
    crossRejected = true;
  }
  const { data: rB } = await admin.from("quote_requests").select("status").eq("id", reqB).single();
  const { data: dB } = await admin.from("drafts").select("sent_at").eq("request_id", reqB).single();
  const crossOk = crossRejected && rB?.status === "awaiting_review" && dB?.sent_at == null;
  console.log(
    `A approves B's request: rejected=${crossRejected}, B.status=${rB?.status}, B.sent_at=${dB?.sent_at ? "set" : "null"} -> ${crossOk ? "PASS" : "FAIL"}`,
  );

  await cleanup();
  const pass = claimedOk && forgeBlocked && sentOk && crossOk;
  console.log(`\nAC-6 + P-APPROVE-AUTH (D-27 outbox, browser approve path): ${pass ? "PASS" : "FAIL"}`);
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
