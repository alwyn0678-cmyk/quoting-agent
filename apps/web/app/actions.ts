"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "../lib/supabase/server";
import { approveRequest, archiveRequest, unarchiveRequest, requeueRequest } from "../src/lib/approve";

/** Re-render every view a mutation can affect. */
function revalidateAll(): void {
  revalidatePath("/");
  revalidatePath("/quotes");
  revalidatePath("/archive");
}

/**
 * Approve → CLAIM for send (D-27 outbox). The dashboard holds no secrets and never sends: it only
 * calls the gated approve_request RPC, which atomically moves the request awaiting_review → 'sending'
 * (exactly-once, tenant-scoped — P-APPROVE-AUTH). The trusted send-outbox worker (service_role + Graph)
 * then sends the reply and finalizes to 'sent' (recording the real, non-forgeable drafts.sent_at).
 */
export async function approveAction(formData: FormData): Promise<void> {
  const requestId = String(formData.get("requestId") ?? "");
  if (!requestId) return;
  const supabase = await createSupabaseServerClient();
  await approveRequest(supabase, requestId);
  revalidateAll();
}

/** Soft-archive a terminal request (sent / escalated / error). */
export async function archiveAction(formData: FormData): Promise<void> {
  const requestId = String(formData.get("requestId") ?? "");
  if (!requestId) return;
  const supabase = await createSupabaseServerClient();
  await archiveRequest(supabase, requestId);
  revalidateAll();
}

/** Restore an archived request to its active lists. */
export async function unarchiveAction(formData: FormData): Promise<void> {
  const requestId = String(formData.get("requestId") ?? "");
  if (!requestId) return;
  const supabase = await createSupabaseServerClient();
  await unarchiveRequest(supabase, requestId);
  revalidateAll();
}

/** Re-run an escalated/errored request: reset it to 'received' so the autonomous agent re-processes it. */
export async function requeueAction(formData: FormData): Promise<void> {
  const requestId = String(formData.get("requestId") ?? "");
  if (!requestId) return;
  const supabase = await createSupabaseServerClient();
  await requeueRequest(supabase, requestId);
  revalidateAll();
}
