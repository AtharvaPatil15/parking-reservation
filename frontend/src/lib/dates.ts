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

/**
 * Today's calendar date in the booking domain's timezone (IST), as yyyy-mm-dd.
 *
 * The rest of this module compares on the *browser's* local date, which is fine for validating what
 * the user typed. This one is different: it is sent to the server as a range bound, so it has to
 * agree with the server's notion of "today" — Asia/Kolkata — regardless of where the browser sits.
 */
export function todayIstIso(): string {
  // `en-CA` formats as yyyy-mm-dd, which is exactly the wire format.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

/** Next Mon–Fri (today if it's a weekday), as yyyy-mm-dd. */
export function nextBookableWeekday(): string {
  const d = todayLocal();
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Format a countdown as `h:mm:ss` (or `m:ss` under an hour); clamps negatives to 0. */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
