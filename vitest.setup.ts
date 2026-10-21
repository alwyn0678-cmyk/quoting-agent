import { beforeEach, afterEach, vi } from "vitest";

/** The suite's fixed "today". Only Date is faked — timers keep running so async code is unaffected. */
export const SUITE_NOW = new Date("2026-06-01T09:00:00Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(SUITE_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});
