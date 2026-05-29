/**
 * Phase 0 slice marker. Exists so the harness smoke test imports a real TypeScript
 * module — proving the TS + Vitest + NodeNext toolchain compiles and runs end to end.
 * Real agent code (schemas, rate engine, extraction, drafting) lands in later tasks.
 */
export const SLICE_ID = "phase-0" as const;
