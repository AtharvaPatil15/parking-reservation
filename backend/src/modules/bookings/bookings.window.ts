/**
 * Rolling booking window + weekly allocation run — the Phase 7 replacement for the same-day 18:00
 * cutoff (see docs/phase-7-no-rejection-booking-and-security.md §3). Pure: no DB, no config I/O, so
 * the date arithmetic that decides what a user may book is unit-testable in isolation.
 *
 * Rules:
 *  - D9  Requests are open for a rolling window of `windowWeeks` (2 or 4) weeks from today.
 *  - D10 Allocation is a weekly batch on `runDay` at `runTime` (IST).
 *  - D11 A date is decided at least `approvalLeadDays` (default 3) days before itself.
 *  - D7  Bookable days are Mon–Fri only (unchanged).
 *
 * The band a run owns is HALF-OPEN — `[runDate + L, nextRunDate + L)` — so consecutive weekly runs
 * partition the calendar: every bookable weekday is decided exactly once, always at least L days
 * ahead of itself, and dates past the band stay open for the following run.
 *
 * All wall-clock reasoning is Asia/Kolkata (IST, UTC+05:30).
 */
import {
  IST_OFFSET_MINUTES,
  currentIstCalendarDate,
  isBookableWeekday,
  isValidCalendarDate,
  parseCalendarDate,
} from './bookings.time';

const IST_OFFSET_MS = IST_OFFSET_MINUTES * 60 * 1000;
const MS_DAY = 24 * 60 * 60 * 1000;

export type RunDay = 'SATURDAY' | 'SUNDAY';

export interface WindowConfig {
  /** How many weeks ahead requests are accepted (D9). */
  windowWeeks: number;
  /** Weekday the weekly allocation batch runs on (D10). */
  runDay: RunDay;
  /** `HH:MM` IST the batch fires at on `runDay` (D10). */
  runTime: string;
  /** Minimum days between a date's decision and the date itself (D11). */
  approvalLeadDays: number;
}

/** Fallbacks mirroring the seeded defaults, used when a config row is missing. */
export const DEFAULT_WINDOW_CONFIG: WindowConfig = {
  windowWeeks: 2,
  runDay: 'SUNDAY',
  runTime: '20:00',
  approvalLeadDays: 3,
};

/** `YYYY-MM-DD` for a UTC-midnight calendar-date instant. */
export const toIsoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** Shift a UTC-midnight calendar date by whole days (DST-free — IST has no DST). */
export const addDays = (d: Date, days: number): Date => new Date(d.getTime() + days * MS_DAY);

function parseHhMm(time: string): [number, number] {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!m) throw new RangeError(`Invalid run time: ${time}`);
  return [Number(m[1]), Number(m[2])];
}

/** 0 = Sunday … 6 = Saturday, matching `Date#getUTCDay`. */
function runDayIndex(runDay: RunDay): number {
  return runDay === 'SUNDAY' ? 0 : 6;
}

/**
 * The next weekly run strictly after `now`. A run happening at exactly `now` counts as already
 * under way, so the answer jumps a week — otherwise a request submitted on the run instant could
 * land in a band that is mid-flight.
 */
export function nextAllocationRunAt(now: Date, cfg: WindowConfig): Date {
  const [hh, mm] = parseHhMm(cfg.runTime);
  // Shifting into IST makes the UTC getters read as IST wall-clock fields.
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const deltaDays = (runDayIndex(cfg.runDay) - ist.getUTCDay() + 7) % 7;
  const at = (extraDays: number) =>
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + deltaDays + extraDays, hh, mm);
  const candidate = at(0);
  return new Date((candidate <= ist.getTime() ? at(7) : candidate) - IST_OFFSET_MS);
}

/** The IST calendar date (UTC-midnight) a run instant falls on. */
export function runCalendarDate(runInstant: Date): Date {
  return currentIstCalendarDate(runInstant);
}

/** First date a user may request right now: the next run's date + the lead time (D11). */
export function earliestRequestableDate(now: Date, cfg: WindowConfig): Date {
  return addDays(runCalendarDate(nextAllocationRunAt(now, cfg)), cfg.approvalLeadDays);
}

/** Last date a user may request right now: today + the configured horizon (D9). */
export function latestRequestableDate(now: Date, cfg: WindowConfig): Date {
  return addDays(currentIstCalendarDate(now), cfg.windowWeeks * 7);
}

/** Bookable weekdays in `[from, to]` (inclusive), as `YYYY-MM-DD`. Empty when `from > to`. */
function weekdaysBetween(from: Date, to: Date): string[] {
  const out: string[] = [];
  for (let d = from; d.getTime() <= to.getTime(); d = addDays(d, 1)) {
    const iso = toIsoDate(d);
    if (isBookableWeekday(iso)) out.push(iso);
  }
  return out;
}

/** Every date a user may submit a request for right now (D7 + D9 + D11). */
export function requestableDates(now: Date, cfg: WindowConfig): string[] {
  return weekdaysBetween(earliestRequestableDate(now, cfg), latestRequestableDate(now, cfg));
}

export type RequestableCheck =
  | { ok: true }
  | { ok: false; code: 'INVALID_DATE' | 'NOT_WEEKDAY' | 'TOO_SOON' | 'BEYOND_WINDOW'; message: string };

/**
 * Whether `date` is open for requests. `TOO_SOON` means the date is already decided (or about to be
 * by the next run) so accepting a request would break the lead-time promise; `BEYOND_WINDOW` means
 * it is past the horizon and simply not open yet.
 */
export function checkRequestable(date: string, now: Date, cfg: WindowConfig): RequestableCheck {
  if (!isValidCalendarDate(date)) {
    return { ok: false, code: 'INVALID_DATE', message: 'Not a valid calendar date' };
  }
  if (!isBookableWeekday(date)) {
    return { ok: false, code: 'NOT_WEEKDAY', message: 'Booking date must be a bookable weekday (Mon–Fri)' };
  }
  const target = parseCalendarDate(date).getTime();
  const earliest = earliestRequestableDate(now, cfg);
  const latest = latestRequestableDate(now, cfg);
  if (target < earliest.getTime()) {
    return {
      ok: false,
      code: 'TOO_SOON',
      message:
        `${date} is no longer open — allocation for it is already decided. ` +
        `The earliest date you can request is ${toIsoDate(earliest)}.`,
    };
  }
  if (target > latest.getTime()) {
    return {
      ok: false,
      code: 'BEYOND_WINDOW',
      message: `${date} is beyond the ${cfg.windowWeeks}-week booking window (open until ${toIsoDate(latest)}).`,
    };
  }
  return { ok: true };
}

export interface AllocationBand {
  /** First date this run decides (inclusive). */
  from: string;
  /** First date the NEXT run decides (exclusive end of this band). */
  toExclusive: string;
  /** The bookable weekdays this run is responsible for. */
  dates: string[];
}

/**
 * The dates a run firing at `runInstant` must decide: `[runDate + L, nextRunDate + L)`. Half-open so
 * successive runs neither overlap (double-deciding a date) nor leave gaps (a date no run owns).
 */
export function allocationBand(runInstant: Date, cfg: WindowConfig): AllocationBand {
  const from = addDays(runCalendarDate(runInstant), cfg.approvalLeadDays);
  const toExclusive = addDays(runCalendarDate(nextAllocationRunAt(runInstant, cfg)), cfg.approvalLeadDays);
  return {
    from: toIsoDate(from),
    toExclusive: toIsoDate(toExclusive),
    dates: weekdaysBetween(from, addDays(toExclusive, -1)),
  };
}

/**
 * The band the *upcoming* scheduled run owns — what a manual "run the weekly batch" click should
 * process.
 *
 * `allocationBand(now)` would be wrong for a manual trigger: invoked on a Monday it returns
 * `[Mon + L, Sun + L)`, a stale band of dates that closed for requests days ago, and would decide
 * nothing while leaving this week's actual requests untouched. Anchoring on the next run instant
 * instead makes `from` identical to `earliestRequestableDate(now)`, so the batch decides exactly the
 * dates that are open now and are due to close at the next boundary.
 *
 * Consequence of running early: dates at the far end of the band are decided before users had the
 * whole window to request them. That is inherent to triggering the batch ahead of schedule.
 */
export function upcomingAllocationBand(now: Date, cfg: WindowConfig): AllocationBand {
  return allocationBand(nextAllocationRunAt(now, cfg), cfg);
}

export interface BookingWindowSummary {
  nextRunAt: string;
  nextRunCountdownSeconds: number;
  runDay: RunDay;
  runTime: string;
  windowWeeks: number;
  approvalLeadDays: number;
  earliestDate: string;
  latestDate: string;
  requestableDates: string[];
}

/** Everything the client needs to render "book between X and Y; results on Z" in one payload. */
export function bookingWindowSummary(now: Date, cfg: WindowConfig): BookingWindowSummary {
  const nextRun = nextAllocationRunAt(now, cfg);
  return {
    nextRunAt: nextRun.toISOString(),
    nextRunCountdownSeconds: Math.max(0, Math.floor((nextRun.getTime() - now.getTime()) / 1000)),
    runDay: cfg.runDay,
    runTime: cfg.runTime,
    windowWeeks: cfg.windowWeeks,
    approvalLeadDays: cfg.approvalLeadDays,
    earliestDate: toIsoDate(earliestRequestableDate(now, cfg)),
    latestDate: toIsoDate(latestRequestableDate(now, cfg)),
    requestableDates: requestableDates(now, cfg),
  };
}
