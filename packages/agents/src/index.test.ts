import { describe, it, expect } from "vitest";
import { SLICE_ID } from "./index.js";

describe("harness smoke test", () => {
  it("compiles a TypeScript module and runs a Vitest test", () => {
    expect(SLICE_ID).toBe("phase-0");
  });
});
