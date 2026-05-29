import { fileURLToPath } from "node:url";

// This app is a self-contained package (folders, not workspaces) with its own lockfile.
// Pin Turbopack's root to this dir so it doesn't infer the monorepo root from the parent lockfile.
const root = fileURLToPath(new URL(".", import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: { root },
  // The dashboard page imports the already-proven lib at apps/web/src/lib (inside this app dir).
  // That lib's ONLY cross-package import is type-only (`import type { RateQuote }` from
  // packages/agents) — erased at build time, so no bundler (Turbopack or webpack) ever resolves
  // outside this app. externalDir is kept as a safety margin for that type-only resolution.
  experimental: { externalDir: true },
};

export default nextConfig;
