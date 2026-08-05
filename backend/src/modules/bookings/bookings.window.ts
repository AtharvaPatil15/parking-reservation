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
const REQUEST_CLOSE_TIME = '19:00';

export type RunDay = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';
export type RunFrequency = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';

export interface WindowConfig {
  /** How many weeks ahead requests are accepted (D9). */
  windowWeeks: number;
  /** Weekday the weekly allocation batch runs on (D10). */
  runDay: RunDay;
  /** How often the automatic allocation batch runs. */
  runFrequency: RunFrequency;
  /** `HH:MM` IST the batch fires at on `runDay` (D10). */
  runTime: string;
  /**
   * `HH:MM` IST the **common-pool** half of the batch fires at, on the same `runDay`.
   *
   * Separate from `runTime` so the Super Admin can leave a gap between "you are waitlisted" and the
   * pool being drawn — the window in which a company can release quota it knows it will not use, which
   * is exactly the inventory the pool redistributes. Equal to `runTime` (the default) means the two
   * halves run back-to-back in one tick, which is the behaviour that predates this setting. Never
   * earlier than `runTime`: the pool's input is the waitlist primary produces.
   */
  commonPoolRunTime: string;
  /** Minimum days between a date's decision and the date itself (D11). */
  approvalLeadDays: number;
}

/**
 * Fallbacks mirroring the seeded defaults, used when a config row is missing.
 *
 * `approvalLeadDays` is 1 as of Phase 8 (D21): with a Sunday run, a 3-day lead pushed the earliest
 * requestable date out to Wednesday, so the requirement "it is Sunday, I want Mon–Fri" could not be
 * expressed at all. Must stay in step with `prisma/seed.ts` — the integration suite derives its test
 * dates from these values and assumes the seeded DB matches.
 */
export const DEFAULT_WINDOW_CONFIG: WindowConfig = {
  windowWeeks: 2,
  runDay: 'SUNDAY',
  runFrequency: 'WEEKLY',
  runTime: '20:00',
  // Same instant as the primary run by default, so out of the box the two halves still run back-to-back
  // in a single tick and nothing about the existing schedule changes.
  commonPoolRunTime: '20:00',
  approvalLeadDays: 1,
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
  return {
    SUNDAY: 0,
    MONDAY: 1,
    TUESDAY: 2,
    WEDNESDAY: 3,
    THURSDAY: 4,
    FRIDAY: 5,
    SATURDAY: 6,
  }[runDay];
}

/**
 * The next weekly run strictly after `now`. A run happening at exactly `now` counts as already
 * under way, so the answer jumps a week — otherwise a request submitted on the run instant could
 * land in a band that is mid-flight.
 */
export function nextAllocationRunAt(now: Date, cfg: WindowConfig): Date {
  const weekly = nextWeeklyAllocationRunAt(now, cfg);
  if (cfg.runFrequency === 'WEEKLY') return weekly;

  const anchor = new Date('2026-08-09T14:30:00.000Z');
  if (cfg.runFrequency === 'BIWEEKLY') {
    let run = nextWeeklyAllocationRunAt(new Date(anchor.getTime() - 1), cfg);
    while (run.getTime() <= now.getTime()) run = addDays(runCalendarDate(run), 14);
    const [hh, mm] = parseHhMm(cfg.runTime);
    const istRun = new Date(run.getTime() + IST_OFFSET_MS);
    return new Date(Date.UTC(istRun.getUTCFullYear(), istRun.getUTCMonth(), istRun.getUTCDate(), hh, mm) - IST_OFFSET_MS);
  }

  return nextMonthlyAllocationRunAt(now, cfg);
}

function nextWeeklyAllocationRunAt(now: Date, cfg: WindowConfig): Date {
  const [hh, mm] = parseHhMm(cfg.runTime);
  // Shifting into IST makes the UTC getters read as IST wall-clock fields.
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const deltaDays = (runDayIndex(cfg.runDay) - ist.getUTCDay() + 7) % 7;
  const at = (extraDays: number) =>
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + deltaDays + extraDays, hh, mm);
  const candidate = at(0);
  return new Date((candidate <= ist.getTime() ? at(7) : candidate) - IST_OFFSET_MS);
}

function nextMonthlyAllocationRunAt(now: Date, cfg: WindowConfig): Date {
  const [hh, mm] = parseHhMm(cfg.runTime);
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const targetDay = runDayIndex(cfg.runDay);
  for (let monthOffset = 0; monthOffset < 24; monthOffset++) {
    const monthStart = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + monthOffset, 1, hh, mm);
    const first = new Date(monthStart);
    const delta = (targetDay - first.getUTCDay() + 7) % 7;
    const candidateIstMs = monthStart + delta * MS_DAY;
    if (candidateIstMs > ist.getTime()) return new Date(candidateIstMs - IST_OFFSET_MS);
  }
  throw new RangeError('Could not resolve next monthly allocation run');
}

function istInstantOnDate(date: Date, hhmm: string): Date {
  const [hh, mm] = parseHhMm(hhmm);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hh, mm) - IST_OFFSET_MS);
}

function requestCloseAtForRun(runInstant: Date): Date {
  return istInstantOnDate(runCalendarDate(runInstant), REQUEST_CLOSE_TIME);
}

function requestWindowRunAt(now: Date, cfg: WindowConfig): Date {
  const run = nextAllocationRunAt(now, cfg);
  return now.getTime() >= requestCloseAtForRun(run).getTime() ? nextAllocationRunAt(run, cfg) : run;
}

/** The IST calendar date (UTC-midnight) a run instant falls on. */
export function runCalendarDate(runInstant: Date): Date {
  return currentIstCalendarDate(runInstant);
}

/** First date a user may request right now: the next run's date + the lead time (D11). */
export function earliestRequestableDate(now: Date, cfg: WindowConfig): Date {
  return addDays(runCalendarDate(requestWindowRunAt(now, cfg)), cfg.approvalLeadDays);
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
 * When the common-pool half of the batch anchored on `primaryRunInstant` fires: the same IST calendar
 * day, at `commonPoolRunTime`.
 *
 * Same day rather than "primary + N hours" so a late pool time can never spill past midnight into a
 * different calendar day — the scheduler's once-per-day guard and the band both key off the run day, and
 * a pool run that believed it belonged to the next day would silently never fire.
 *
 * Clamped to `primaryRunInstant`: config validation rejects an earlier pool time, but a hand-edited row
 * or a stale cache must not be able to draw the pool before there is a waitlist to draw it from.
 */
export function commonPoolRunAtFor(primaryRunInstant: Date, cfg: WindowConfig): Date {
  const at = istInstantOnDate(runCalendarDate(primaryRunInstant), cfg.commonPoolRunTime);
  return at.getTime() < primaryRunInstant.getTime() ? primaryRunInstant : at;
}

/**
 * The most recent scheduled run at or before `now` — the run whose decisions are currently live.
 *
 * `nextAllocationRunAt` alone cannot answer this: subtracting a week is only right for WEEKLY, and
 * month-boundary arithmetic for MONTHLY ("first Sunday of the month") does not reduce to a fixed offset.
 * So step back far enough to be certain at least one run instant falls in `(probe, now]`, then walk
 * forward with the same function that defines the schedule — no second, drifting implementation.
 */
export function previousAllocationRunAt(now: Date, cfg: WindowConfig): Date {
  const lookbackDays = cfg.runFrequency === 'MONTHLY' ? 70 : cfg.runFrequency === 'BIWEEKLY' ? 15 : 8;
  let prev = nextAllocationRunAt(new Date(now.getTime() - lookbackDays * MS_DAY), cfg);
  for (;;) {
    const next = nextAllocationRunAt(prev, cfg);
    if (next.getTime() > now.getTime()) return prev;
    prev = next;
  }
}

export function nextAllocationRuns(now: Date, cfg: WindowConfig, count = 5): string[] {
  const runs: string[] = [];
  let cursor = now;
  for (let i = 0; i < count; i++) {
    const next = nextAllocationRunAt(cursor, cfg);
    runs.push(next.toISOString());
    cursor = next;
  }
  return runs;
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

/**
 * The live scoring weights and caps, echoed to the client (P8-04).
 *
 * Phase 8 decides who gets a slot by score, so a user is entitled to see what their score *is* before
 * they commit — and to watch it move as they add carpool members. Shipping the coefficients lets the
 * form compute it locally with no round-trip; the formula is three lines
 * (see `allocation/score.ts`). Read from config by `loadScoringConfig`, and passed in here rather than
 * loaded, because this module stays pure.
 */
export interface ScoringSummary {
  distanceWeight: number;
  carpoolWeight: number;
  maxDistanceKm: number;
  maxPeople: number;
}

export interface BookingWindowSummary {
  nextRunAt: string;
  nextRunCountdownSeconds: number;
  requestCloseAt: string;
  requestCloseCountdownSeconds: number;
  resultsRunAt: string;
  runDay: RunDay;
  runFrequency: RunFrequency;
  runTime: string;
  commonPoolRunTime: string;
  nextCommonPoolRunAt: string;
  windowWeeks: number;
  approvalLeadDays: number;
  earliestDate: string;
  latestDate: string;
  requestableDates: string[];
  nextRuns: string[];
  scoring: ScoringSummary;
}

/** Everything the client needs to render "book between X and Y; results on Z" in one payload. */
export function bookingWindowSummary(
  now: Date,
  cfg: WindowConfig,
  scoring: ScoringSummary,
): BookingWindowSummary {
  const nextRun = nextAllocationRunAt(now, cfg);
  const windowRun = requestWindowRunAt(now, cfg);
  const requestClose = requestCloseAtForRun(windowRun);
  // The pool trails primary on the same day, so between the two instants the *next* pool run belongs to
  // the run that has already fired — not to `nextRun`, which is a week out.
  const thisPool = commonPoolRunAtFor(previousAllocationRunAt(now, cfg), cfg);
  const nextPool = thisPool.getTime() > now.getTime() ? thisPool : commonPoolRunAtFor(nextRun, cfg);
  return {
    nextRunAt: nextRun.toISOString(),
    nextRunCountdownSeconds: Math.max(0, Math.floor((nextRun.getTime() - now.getTime()) / 1000)),
    requestCloseAt: requestClose.toISOString(),
    requestCloseCountdownSeconds: Math.max(0, Math.floor((requestClose.getTime() - now.getTime()) / 1000)),
    resultsRunAt: windowRun.toISOString(),
    runDay: cfg.runDay,
    runFrequency: cfg.runFrequency,
    runTime: cfg.runTime,
    commonPoolRunTime: cfg.commonPoolRunTime,
    nextCommonPoolRunAt: nextPool.toISOString(),
    windowWeeks: cfg.windowWeeks,
    approvalLeadDays: cfg.approvalLeadDays,
    earliestDate: toIsoDate(earliestRequestableDate(now, cfg)),
    latestDate: toIsoDate(latestRequestableDate(now, cfg)),
    requestableDates: requestableDates(now, cfg),
    nextRuns: nextAllocationRuns(now, cfg, 5),
    scoring,
  };
}
