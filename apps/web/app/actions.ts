"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { describeMutationError, FLASH_COOKIE, type ReviewerAction } from "../src/lib/flash";
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
 * RAISE on a state conflict (double-approve, double-archive, …) — expected under racing reviewers.
 * The error is logged AND shown to the reviewer once (flash cookie), and the views revalidate so the
 * true DB state renders — a failed approve is never silent.
 */
async function runMutation(
  action: ReviewerAction,
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
    (await cookies()).set(FLASH_COOKIE, describeMutationError(action, error), {
      maxAge: 15,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
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
  await runMutation("approve", String(formData.get("requestId") ?? ""), approveRequest);
}

/** Soft-archive a terminal request (sent / escalated / error). */
export async function archiveAction(formData: FormData): Promise<void> {
  await runMutation("archive", String(formData.get("requestId") ?? ""), archiveRequest);
}

/** Restore an archived request to its active lists. */
export async function unarchiveAction(formData: FormData): Promise<void> {
  await runMutation("unarchive", String(formData.get("requestId") ?? ""), unarchiveRequest);
}

/** Re-run an escalated/errored request: reset it to 'received' so the autonomous agent re-processes it. */
export async function requeueAction(formData: FormData): Promise<void> {
  await runMutation("requeue", String(formData.get("requestId") ?? ""), requeueRequest);
}
