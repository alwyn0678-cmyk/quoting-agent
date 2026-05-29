/**
 * Approve a quote request → simulated send (1C.4). This is the ONLY browser path that can set a
 * request's status to 'sent': it calls the SECURITY DEFINER `approve_request()` RPC (migration 0004),
 * which enforces the caller's tenant and the awaiting_review→sent state machine in one transaction.
 *
 * No Graph send is invoked anywhere — the "send" is simulated server-side (drafts.simulated_sent_at).
 * AC-6 (a request reaches 'sent' only via approve), AC-7 (zero send calls in the approve path),
 * P-APPROVE-AUTH (a reviewer in tenant A cannot approve a tenant B request — the RPC's tenant check
 * rejects it).
 *
 * Typed against a narrow structural `RpcCaller` (not the concrete SupabaseClient) — same rationale as
 * RequestsReader in dashboard.ts: no supabase-js type dependency, immune to dependency duplication
 * across the two install roots, and trivially fakeable. Any real SupabaseClient satisfies it.
 */
export interface RpcCaller {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ error: unknown }>;
}

export async function approveRequest(client: RpcCaller, requestId: string): Promise<void> {
  const { error } = await client.rpc("approve_request", { p_request_id: requestId });
  if (error) throw error;
}
