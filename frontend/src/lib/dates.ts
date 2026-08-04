/**
 * Date helpers shared across features (booking form, dashboards, allocation run,
 * booking status). Relocated here from `features/user/bookingSchema` once the
 * super-admin area began consuming them.
 *
 * All comparisons are on the local calendar date (midnight), matching how the
 * booking domain treats a `yyyy-mm-dd` bookingDate.
 */

/** Parse `yyyy-mm-dd` to a local midnight Date, or null if malformed / non-round-tripping. */
function parseLocalDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  // Reject dates JS normalized (e.g. 2026-02-31 → Mar 3): components must round-trip.
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

/** Today at local midnight. */
function todayLocal(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

/** True when `yyyy-mm-dd` is a valid date that is today or later (local date compare). */
export function isTodayOrFuture(value: string): boolean {
  const date = parseLocalDate(value);
  if (!date) return false;
  return date.getTime() >= todayLocal().getTime();
}

/** True when `yyyy-mm-dd` is Mon–Fri and today-or-later (local date compare). */
export function isBookableWeekday(value: string): boolean {
  const date = parseLocalDate(value);
  if (!date) return false;
  const day = date.getDay(); // 0=Sun..6=Sat
  if (day === 0 || day === 6) return false;
  return date.getTime() >= todayLocal().getTime();
}

/** Next Mon–Fri (today if it's a weekday), as yyyy-mm-dd. */
export function nextBookableWeekday(): string {
  const d = todayLocal();
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Format a countdown as `h:mm:ss` (or `m:ss` under an hour); clamps negatives to 0.
 * Floors the input so a fractional second can't render as `59.90000000000009`.
 */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.floor(Math.max(0, totalSeconds)) || 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(sec)}` : `${m}:${pad2(sec)}`;
}

/**
 * Format a countdown that can span days, e.g. `5d 6h`, `6h 21m`, `21m 49s`.
 *
 * `formatCountdown` rolls days into the hour field, which is fine for a cutoff hours away but
 * renders a multi-day allocation wait as an unreadable `126:21:49`. Only the two most significant
 * units are shown — nobody reads seconds off a five-day countdown.
 *
 * Floors the input (and maps NaN to 0) so a fractional second can't leak into the output.
 */
export function formatLongCountdown(totalSeconds: number): string {
  const s = Math.floor(Math.max(0, totalSeconds)) || 0;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${pad2(m)}m`;
  return `${m}m ${pad2(sec)}s`;
}
