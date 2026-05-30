"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "../lib/supabase/server";
import { approveRequest } from "../src/lib/approve";

/**
 * Approve → simulated send (1C.4b). Runs server-side under the reviewer's session: it calls
 * approveRequest(), i.e. the approve_request() RPC, which enforces the caller's tenant + the
 * awaiting_review→sent state machine (P-APPROVE-AUTH / AC-6). No Graph send (AC-7). A forged
 * requestId for another tenant is rejected by the RPC, so the DB is the authority — no extra check
 * needed here. revalidate so the card flips to SIMULATED SEND.
 */
export async function approveAction(formData: FormData): Promise<void> {
  const requestId = String(formData.get("requestId") ?? "");
  if (!requestId) return;
  const supabase = await createSupabaseServerClient();
  await approveRequest(supabase, requestId);
  revalidatePath("/");
  revalidatePath("/quotes");
}
