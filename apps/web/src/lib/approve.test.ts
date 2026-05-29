import { describe, it, expect } from "vitest";
import { approveRequest, type RpcCaller } from "./approve.js";

describe("AC-7 — approve path calls only the approve_request RPC, never a send", () => {
  it("invokes approve_request with the request id and touches no send method", async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    let sendCount = 0;
    // A fake client with BOTH rpc and a send spy. The approve path must call rpc once and never send.
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

    await approveRequest(client as unknown as RpcCaller, "req-123");

    expect(calls).toEqual([{ fn: "approve_request", args: { p_request_id: "req-123" } }]);
    expect(sendCount).toBe(0); // AC-7: zero send calls in the approve path
  });

  it("throws when the RPC returns an error (cross-tenant / not approvable → P-APPROVE-AUTH, AC-6)", async () => {
    const client: RpcCaller = {
      rpc() {
        return Promise.resolve({ error: { message: "not approvable by caller" } });
      },
    };
    await expect(approveRequest(client, "req-x")).rejects.toBeTruthy();
  });
});
