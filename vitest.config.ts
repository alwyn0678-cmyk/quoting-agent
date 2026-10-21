import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Hermetic suite: pin the wall clock so date-dependent rules (rate validity) are reproducible.
    setupFiles: ["./vitest.setup.ts"],
  },
});
