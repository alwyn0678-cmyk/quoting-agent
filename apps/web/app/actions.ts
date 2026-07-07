"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "../lib/supabase/server";
import { approveRequest, archiveRequest, unarchiveRequest, requeueRequest, type RpcCaller } from "../src/lib/approve";

/** Re-render every view a mutation can affect. */
function revalidateAll(): void {
  revalidatePath("/");
  revalidatePath("/quotes");
  revalidatePath("/archive");
}

/**
 * Run one reviewer mutation without letting an RPC error crash the page. The SECURITY DEFINER RPCs
 * RAISE on a state conflict (double-approve, double-archive, …) — expected under racing reviewers —
 * so we log the error and still revalidate: the losing racer simply re-renders the true DB state
 * (already approved/archived) instead of hitting the error boundary.
 */
async function runMutation(
  action: string,
  requestId: string,
  mutate: (client: RpcCaller, requestId: string) => Promise<void>,
): Promise<void> {
  if (!requestId) {
    console.error(`${action}: missing requestId in form data — ignoring the submission`);
    return;
  }
  try {
    const supabase = await createSupabaseServerClient();
    await mutate(supabase, requestId);
  } catch (error) {
    console.error(`${action}: RPC failed for request ${requestId}`, error);
  }
  revalidateAll();
}

/**
 * Approve → CLAIM for send (D-27 outbox). The dashboard holds no secrets and never sends: it only
 * calls the gated approve_request RPC, which atomically moves the request awaiting_review → 'sending'
 * (exactly-once, tenant-scoped — P-APPROVE-AUTH). The trusted send-outbox worker (service_role + Graph)
 * then sends the reply and finalizes to 'sent' (recording the real, non-forgeable drafts.sent_at).
 */
export async function approveAction(formData: FormData): Promise<void> {
  await runMutation("approveAction", String(formData.get("requestId") ?? ""), approveRequest);
}

/** Soft-archive a terminal request (sent / escalated / error). */
export async function archiveAction(formData: FormData): Promise<void> {
  await runMutation("archiveAction", String(formData.get("requestId") ?? ""), archiveRequest);
}

/** Restore an archived request to its active lists. */
export async function unarchiveAction(formData: FormData): Promise<void> {
  await runMutation("unarchiveAction", String(formData.get("requestId") ?? ""), unarchiveRequest);
}

/** Re-run an escalated/errored request: reset it to 'received' so the autonomous agent re-processes it. */
export async function requeueAction(formData: FormData): Promise<void> {
  await runMutation("requeueAction", String(formData.get("requestId") ?? ""), requeueRequest);
}
