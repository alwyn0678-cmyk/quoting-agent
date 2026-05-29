import { defineConfig } from "@trigger.dev/sdk";

// QuoteAgent Trigger.dev project (Personal org, created 2026-05-29). Tasks live in ./src/trigger.
// Retries are OFF in dev (deterministic local runs) and bounded in prod — the durable run is
// idempotent (claim + insert-once), so a retry after a crash re-runs nothing already committed.
export default defineConfig({
  project: "proj_gstlipolkkbzftxqzcwg",
  dirs: ["./src/trigger"],
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  maxDuration: 3600,
});
