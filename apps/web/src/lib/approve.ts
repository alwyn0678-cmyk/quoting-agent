/**
 * Reviewer (HITL) mutations — thin wrappers over the SECURITY DEFINER RPCs (migrations 0006/0011),
 * each of which enforces the caller's tenant + the allowed state transition in one transaction. The
 * browser `authenticated` role has NO direct DML (0003), so these RPCs are the ONLY write paths:
 *   - approve_request   — awaiting_review → 'sending' (the human CLAIM; the one path that lets a send
 *                         happen, AC-6 / P-APPROVE-AUTH). The dashboard never sends and never writes
 *                         'sent'; the trusted send-outbox worker finalizes (D-27 outbox).
 *   - archive/unarchive — soft-archive toggle for terminal requests.
 *   - requeue_request   — escalated|error → received, so the autonomous agent re-runs it.
 *
 * Typed against a narrow structural `RpcCaller` (not the concrete SupabaseClient) — no supabase-js type
 * dependency, immune to dependency duplication across install roots, trivially fakeable. Any real
 * SupabaseClient satisfies it.
 */
export interface RpcCaller {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ error: unknown }>;
}

export async function approveRequest(client: RpcCaller, requestId: string): Promise<void> {
  const { error } = await client.rpc("approve_request", { p_request_id: requestId });
  if (error) throw error;
}

export async function archiveRequest(client: RpcCaller, requestId: string): Promise<void> {
  const { error } = await client.rpc("archive_request", { p_request_id: requestId });
  if (error) throw error;
}

export async function unarchiveRequest(client: RpcCaller, requestId: string): Promise<void> {
  const { error } = await client.rpc("unarchive_request", { p_request_id: requestId });
  if (error) throw error;
}

export async function requeueRequest(client: RpcCaller, requestId: string): Promise<void> {
  const { error } = await client.rpc("requeue_request", { p_request_id: requestId });
  if (error) throw error;
}
