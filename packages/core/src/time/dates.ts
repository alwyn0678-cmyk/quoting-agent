import { z } from "zod";

/**
 * Calendar dates (YYYY-MM-DD) — validated as REAL dates (2026-02-31 is rejected, not normalised), and
 * compared as strings only after validation (lexical order = chronological order for this format).
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export const IsoDateSchema = z.string().refine(isIsoDate, "real calendar date (YYYY-MM-DD)");

export function dayNumber(iso: string): number {
  if (!isIsoDate(iso)) throw new Error(`not a calendar date: '${iso}'`);
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
}

export function addDays(iso: string, days: number): string {
  return new Date((dayNumber(iso) + days) * 86_400_000).toISOString().slice(0, 10);
}

export const maxDate = (a: string, b: string): string => (a >= b ? a : b);
export const minDate = (a: string, b: string): string => (a <= b ? a : b);
