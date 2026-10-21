import { describe, it, expect } from "vitest";
import { describeMutationError } from "./flash.js";

describe("P0 — reviewer actions report failures instead of swallowing them", () => {
  it("a state conflict (another reviewer won the race) is explained, not alarming", () => {
    const msg = describeMutationError("approve", { code: "P0001", message: "approve_request: x not approvable" });
    expect(msg).toMatch(/already been handled/i);
  });
  it("a check violation from the RPC's tenant/state guard reads the same way", () => {
    expect(describeMutationError("archive", { code: "23514", message: "not archivable" })).toMatch(/already been handled/i);
  });
  it("any other failure says what failed and what to do", () => {
    const msg = describeMutationError("requeue", new Error("fetch failed"));
    expect(msg).toMatch(/couldn't re-run/i);
    expect(msg).toMatch(/try again/i);
  });
  it("never leaks raw database text to the page", () => {
    expect(describeMutationError("approve", { code: "XX000", message: "relation secret_table does not exist" })).not.toMatch(/secret_table/);
  });
});
