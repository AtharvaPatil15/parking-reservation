/**
 * Pure date/window helpers for booking validation (P4-12). No DB, no config I/O — the
 * correctness-critical time logic lives here so it can be unit-tested in isolation.
 *
 * Rules (decisions.md):
 *  - D7 / F1: bookable days are Mon–Fri only; the evening window targets the next bookable
 *    weekday (so the submission deadline for a date is on the preceding calendar day).
 *  - F2: the cutoff is strict — a submit at exactly the cutoff instant is already closed.
 * All scheduling is Asia/Kolkata (IST, UTC+05:30).
 */

export const IST_OFFSET_MINUTES = 330; // UTC+05:30
const IST_OFFSET_MS = IST_OFFSET_MINUTES * 60 * 1000;

/** Parse a `YYYY-MM-DD` calendar date to its UTC-midnight instant (timezone-stable). */
export function parseCalendarDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** True if `date` is a real calendar date and round-trips (rejects e.g. 2026-02-30, 2026-13-01). */
export function isValidCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = parseCalendarDate(date);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

/** True if `date` falls on Mon–Fri (D7). Weekend → false. Assumes a valid date. */
export function isBookableWeekday(date: string): boolean {
  const dow = parseCalendarDate(date).getUTCDay(); // 0 Sun .. 6 Sat
  return dow >= 1 && dow <= 5;
}

/**
 * The primary submission deadline for a target `bookingDate`: `cutoff` (HH:MM, IST) on the
 * calendar day immediately before `bookingDate` (F1 — the evening window targets the next
 * bookable weekday). Returned as a UTC instant.
 */
export function primaryCutoffInstant(bookingDate: string, cutoff: string): Date {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(cutoff);
  if (!m) throw new RangeError(`Invalid cutoff time: ${cutoff}`);
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const prev = parseCalendarDate(bookingDate);
  prev.setUTCDate(prev.getUTCDate() - 1);
  const utcMs =
    Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth(), prev.getUTCDate(), hh, mm) - IST_OFFSET_MS;
  return new Date(utcMs);
}

/** True if `now` is strictly before the primary cutoff for `bookingDate` (F2 — exact = closed). */
export function isBeforePrimaryCutoff(now: Date, bookingDate: string, cutoff: string): boolean {
  return now.getTime() < primaryCutoffInstant(bookingDate, cutoff).getTime();
}
