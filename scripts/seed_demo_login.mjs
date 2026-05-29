// Local demo helper (not part of the build): create/find an auth user and map its profile to the
// Linkport demo tenant, so a magic-link login surfaces the autonomously-processed quotes via RLS.
// Usage: node --env-file=.env scripts/seed_demo_login.mjs [email]
import { createClient } from "@supabase/supabase-js";

const email = process.argv[2] ?? "alwyn0678@gmail.com";
const LINKPORT = "11111111-1111-4111-8111-111111111111";

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
if (listErr) throw listErr;
let user = list.users.find((u) => u.email === email);
if (!user) {
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  user = data.user;
  console.log(`created user ${email}`);
} else {
  console.log(`user ${email} already exists`);
}

const { error: pErr } = await admin.from("profiles").upsert({ user_id: user.id, tenant_id: LINKPORT });
if (pErr) throw pErr;
console.log(`profile mapped: ${user.id} -> tenant ${LINKPORT} (Linkport demo)`);
