import { describe, it, expect } from "vitest";
import {
  approveRequest,
  archiveRequest,
  unarchiveRequest,
  requeueRequest,
  type RpcCaller,
} from "./approve.js";

/** A fake client recording rpc calls + a `send` spy proving the wrappers never call a send method. */
function fakeClient() {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  let sendCount = 0;
  const client = {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      return Promise.resolve({ error: null });
    },
    send() {
      sendCount++;
      return Promise.resolve();
    },
  };
  return { client: client as unknown as RpcCaller, calls, sendCount: () => sendCount };
}

describe("reviewer mutation wrappers (HITL RPCs)", () => {
  it("approveRequest calls approve_request with p_sent (default false) and never sends itself", async () => {
    // The real Graph send happens in the server action (graph-send.ts), NOT in this wrapper — so the
    // wrapper still calls the RPC only (D-27: the approve PATH sends; approveRequest does not).
    const f = fakeClient();
    await approveRequest(f.client, "req-123");
    expect(f.calls).toEqual([{ fn: "approve_request", args: { p_request_id: "req-123", p_sent: false } }]);
    expect(f.sendCount()).toBe(0);
  });

  it("approveRequest passes p_sent=true when a real send was performed (records drafts.sent_at)", async () => {
    const f = fakeClient();
    await approveRequest(f.client, "req-9", true);
    expect(f.calls).toEqual([{ fn: "approve_request", args: { p_request_id: "req-9", p_sent: true } }]);
  });

  it("archive / unarchive / requeue each call their tenant-scoped RPC with the request id", async () => {
    const f = fakeClient();
    await archiveRequest(f.client, "r1");
    await unarchiveRequest(f.client, "r2");
    await requeueRequest(f.client, "r3");
    expect(f.calls).toEqual([
      { fn: "archive_request", args: { p_request_id: "r1" } },
      { fn: "unarchive_request", args: { p_request_id: "r2" } },
      { fn: "requeue_request", args: { p_request_id: "r3" } },
    ]);
  });

  it("each wrapper throws when its RPC errors (cross-tenant / wrong-state → P-APPROVE-AUTH, AC-6)", async () => {
    const erroring: RpcCaller = { rpc: () => Promise.resolve({ error: { message: "not allowed" } }) };
    await expect(approveRequest(erroring, "x")).rejects.toBeTruthy();
    await expect(archiveRequest(erroring, "x")).rejects.toBeTruthy();
    await expect(unarchiveRequest(erroring, "x")).rejects.toBeTruthy();
    await expect(requeueRequest(erroring, "x")).rejects.toBeTruthy();
  });
});
