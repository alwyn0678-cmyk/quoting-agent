"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "../lib/supabase/server";
import { approveRequest, archiveRequest, unarchiveRequest, requeueRequest } from "../src/lib/approve";
import { hasGraphSendEnv, sendQuoteReply, parseEmailAddress } from "../src/lib/graph-send";

/** Re-render every view a mutation can affect. */
function revalidateAll(): void {
  revalidatePath("/");
  revalidatePath("/quotes");
  revalidatePath("/archive");
}

interface DraftLite {
  subject: string;
  body: string;
}
function firstDraft(d: unknown): DraftLite | null {
  if (Array.isArray(d)) return (d[0] as DraftLite) ?? null;
  return (d as DraftLite) ?? null;
}

/**
 * Approve → REAL send (D-27, reverses D-14). Send-first ordering: we send the reply via Graph and only
 * then flip the request to 'sent' through the gated approve_request RPC — so a send failure leaves the
 * request approvable (retryable), never a 'sent' row with no email. The RPC is the authority on
 * tenant + state (a forged/cross-tenant id is rejected there), so the read below is convenience.
 *
 * Stub-safe: if GRAPH_* is not configured for the dashboard, we skip the send and approve_request runs
 * with p_sent=false → the legacy simulated send. So the deployed dashboard works before GRAPH_* is set.
 */
export async function approveAction(formData: FormData): Promise<void> {
  const requestId = String(formData.get("requestId") ?? "");
  if (!requestId) return;
  const supabase = await createSupabaseServerClient();

  let realSent = false;
  if (hasGraphSendEnv()) {
    const { data } = await supabase
      .from("quote_requests")
      .select("status, from_email, drafts(subject, body)")
      .eq("id", requestId)
      .maybeSingle();
    const row = data as { status?: string; from_email?: string | null; drafts?: unknown } | null;
    const draft = firstDraft(row?.drafts);
    const to = row?.from_email ? parseEmailAddress(row.from_email) : null;
    if (row?.status === "awaiting_review" && draft && to) {
      await sendQuoteReply(to, draft.subject, draft.body); // throws → nothing flipped, retryable
      realSent = true;
    }
  }

  await approveRequest(supabase, requestId, realSent);
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
