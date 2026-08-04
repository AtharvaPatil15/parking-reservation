import { describe, it, expect } from 'vitest';
import {
  DEFAULT_WINDOW_CONFIG,
  allocationBand,
  bookingWindowSummary,
  checkRequestable,
  earliestRequestableDate,
  latestRequestableDate,
  nextAllocationRunAt,
  requestableDates,
  toIsoDate,
  upcomingAllocationBand,
  type WindowConfig,
} from '../src/modules/bookings/bookings.window';
import { parseCalendarDate } from '../src/modules/bookings/bookings.time';

/**
 * Phase 7 — the rolling booking window + weekly run band (docs/phase-7 §3).
 *
 * Anchor calendar (2026): Jul 31 Fri · Aug 1 Sat · Aug 2 Sun · Aug 3 MON · Aug 8 Sat · Aug 9 SUN ·
 * Aug 12 Wed · Aug 15/16 Sat/Sun · Aug 17 Mon · Aug 19 Wed · Aug 23 Sun.
 * 20:00 IST == 14:30 UTC the same day.
 */

/**
 * 2 weeks, SUNDAY 20:00, **3 days lead**.
 *
 * Pinned explicitly rather than taken from `DEFAULT_WINDOW_CONFIG`, which Phase 8 (D21) moved to a
 * 1-day lead. Every worked example below is calculated by hand against a 3-day lead, and these tests
 * exist to pin the *arithmetic*, not the shipped default — so they must not move when someone retunes
 * the config. The default itself is asserted separately, at the bottom of this file.
 */
const SUNDAY_CFG: WindowConfig = { ...DEFAULT_WINDOW_CONFIG, approvalLeadDays: 3 };
const MONDAY_MORNING = new Date('2026-08-03T04:30:00.000Z'); // Mon 03 Aug, 10:00 IST

/** Scoring coefficients are echoed through the summary untouched; any values will do here. */
const SCORING = { distanceWeight: 0.6, carpoolWeight: 0.4, maxDistanceKm: 40, maxPeople: 4 };

const cfg = (over: Partial<WindowConfig> = {}): WindowConfig => ({ ...SUNDAY_CFG, ...over });

describe('nextAllocationRunAt (D10)', () => {
  it('finds the coming Sunday 20:00 IST from a Monday', () => {
    expect(nextAllocationRunAt(MONDAY_MORNING, SUNDAY_CFG).toISOString()).toBe('2026-08-09T14:30:00.000Z');
  });

  it('honours a SATURDAY run day', () => {
    expect(nextAllocationRunAt(MONDAY_MORNING, cfg({ runDay: 'SATURDAY' })).toISOString()).toBe(
      '2026-08-08T14:30:00.000Z',
    );
  });

  it('treats a run happening exactly now as under way and jumps a week', () => {
    const runInstant = new Date('2026-08-09T14:30:00.000Z');
    expect(nextAllocationRunAt(runInstant, SUNDAY_CFG).toISOString()).toBe('2026-08-16T14:30:00.000Z');
  });

  it('still returns the same day when it is the run day but before the run time', () => {
    // Sun 09 Aug 09:00 IST == 03:30Z — the run has not fired yet today.
    expect(nextAllocationRunAt(new Date('2026-08-09T03:30:00.000Z'), SUNDAY_CFG).toISOString()).toBe(
      '2026-08-09T14:30:00.000Z',
    );
  });

  it('uses the IST day, not the UTC day, just after IST midnight', () => {
    // 2026-08-09T18:30Z == Mon 10 Aug 00:00 IST → the Sunday run has passed; next is 16 Aug.
    expect(nextAllocationRunAt(new Date('2026-08-09T18:30:00.000Z'), SUNDAY_CFG).toISOString()).toBe(
      '2026-08-16T14:30:00.000Z',
    );
  });

  it('rejects a malformed run time', () => {
    expect(() => nextAllocationRunAt(MONDAY_MORNING, cfg({ runTime: '25:61' }))).toThrow(RangeError);
  });
});

describe('requestable window (D9 + D11)', () => {
  it('opens `approvalLeadDays` after the next run date', () => {
    // next run 09 Aug + 3 days = 12 Aug.
    expect(toIsoDate(earliestRequestableDate(MONDAY_MORNING, SUNDAY_CFG))).toBe('2026-08-12');
  });

  it('closes windowWeeks*7 days after today', () => {
    expect(toIsoDate(latestRequestableDate(MONDAY_MORNING, SUNDAY_CFG))).toBe('2026-08-17');
    expect(toIsoDate(latestRequestableDate(MONDAY_MORNING, cfg({ windowWeeks: 4 })))).toBe('2026-08-31');
  });

  it('lists only Mon–Fri inside the window (D7)', () => {
    expect(requestableDates(MONDAY_MORNING, SUNDAY_CFG)).toEqual([
      '2026-08-12', // Wed
      '2026-08-13', // Thu
      '2026-08-14', // Fri
      '2026-08-17', // Mon — 15/16 Aug are the weekend and are skipped
    ]);
  });

  it('offers a materially longer list on the 4-week horizon', () => {
    const four = requestableDates(MONDAY_MORNING, cfg({ windowWeeks: 4 }));
    expect(four[0]).toBe('2026-08-12');
    expect(four.at(-1)).toBe('2026-08-31');
    expect(four).toHaveLength(14);
    expect(four.every((d) => parseCalendarDate(d).getUTCDay() >= 1 && parseCalendarDate(d).getUTCDay() <= 5)).toBe(true);
  });

  it('never opens a date sooner than the lead time allows', () => {
    for (const weeks of [2, 4] as const) {
      for (const runDay of ['SATURDAY', 'SUNDAY'] as const) {
        const c = cfg({ windowWeeks: weeks, runDay });
        const nextRun = nextAllocationRunAt(MONDAY_MORNING, c);
        for (const d of requestableDates(MONDAY_MORNING, c)) {
          const leadMs = parseCalendarDate(d).getTime() - parseCalendarDate(toIsoDate(nextRun)).getTime();
          expect(leadMs / (24 * 3600 * 1000)).toBeGreaterThanOrEqual(c.approvalLeadDays);
        }
      }
    }
  });

  it('locks the closing band at 19:00 IST on the run day', () => {
    const beforeClose = new Date('2026-08-09T13:29:59.000Z');
    const atClose = new Date('2026-08-09T13:30:00.000Z');

    expect(checkRequestable('2026-08-12', beforeClose, SUNDAY_CFG)).toEqual({ ok: true });
    expect(checkRequestable('2026-08-12', atClose, SUNDAY_CFG)).toMatchObject({ ok: false, code: 'TOO_SOON' });
    expect(toIsoDate(earliestRequestableDate(atClose, SUNDAY_CFG))).toBe('2026-08-19');
  });
});

describe('checkRequestable', () => {
  it('accepts a date inside the window', () => {
    expect(checkRequestable('2026-08-12', MONDAY_MORNING, SUNDAY_CFG)).toEqual({ ok: true });
  });

  it('rejects a date already decided as TOO_SOON', () => {
    const r = checkRequestable('2026-08-11', MONDAY_MORNING, SUNDAY_CFG);
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ code: 'TOO_SOON' });
    // The message must point the user at the first date they *can* pick.
    if (!r.ok) expect(r.message).toContain('2026-08-12');
  });

  it('rejects a date past the horizon as BEYOND_WINDOW', () => {
    expect(checkRequestable('2026-08-18', MONDAY_MORNING, SUNDAY_CFG)).toMatchObject({
      ok: false,
      code: 'BEYOND_WINDOW',
    });
  });

  it('rejects weekends and impossible dates', () => {
    expect(checkRequestable('2026-08-15', MONDAY_MORNING, SUNDAY_CFG)).toMatchObject({ code: 'NOT_WEEKDAY' });
    expect(checkRequestable('2026-02-30', MONDAY_MORNING, SUNDAY_CFG)).toMatchObject({ code: 'INVALID_DATE' });
    expect(checkRequestable('2026-8-12', MONDAY_MORNING, SUNDAY_CFG)).toMatchObject({ code: 'INVALID_DATE' });
  });
});

describe('allocationBand (D10/D11 — half-open, partitions the calendar)', () => {
  const firstRun = new Date('2026-08-09T14:30:00.000Z'); // Sun 09 Aug 20:00 IST
  const secondRun = new Date('2026-08-16T14:30:00.000Z');

  it('owns [runDate + lead, nextRunDate + lead)', () => {
    expect(allocationBand(firstRun, SUNDAY_CFG)).toEqual({
      from: '2026-08-12',
      toExclusive: '2026-08-19',
      dates: ['2026-08-12', '2026-08-13', '2026-08-14', '2026-08-17', '2026-08-18'],
    });
  });

  it('hands the next band to the next run with no overlap and no gap', () => {
    const a = allocationBand(firstRun, SUNDAY_CFG);
    const b = allocationBand(secondRun, SUNDAY_CFG);
    expect(b.from).toBe(a.toExclusive); // contiguous
    expect(a.dates.filter((d) => b.dates.includes(d))).toEqual([]); // disjoint
    expect(b.dates).toEqual(['2026-08-19', '2026-08-20', '2026-08-21', '2026-08-24', '2026-08-25']);
  });

  it('decides every date at least `approvalLeadDays` ahead of itself (D11)', () => {
    for (const run of [firstRun, secondRun]) {
      const runDate = parseCalendarDate(toIsoDate(run));
      for (const d of allocationBand(run, SUNDAY_CFG).dates) {
        const days = (parseCalendarDate(d).getTime() - runDate.getTime()) / (24 * 3600 * 1000);
        expect(days).toBeGreaterThanOrEqual(SUNDAY_CFG.approvalLeadDays);
      }
    }
  });

  it('covers every bookable weekday exactly once across consecutive runs', () => {
    // Walk 8 weekly runs and assert the union is the full weekday sequence with no repeats.
    const seen: string[] = [];
    let run = firstRun;
    for (let i = 0; i < 8; i++) {
      seen.push(...allocationBand(run, SUNDAY_CFG).dates);
      run = nextAllocationRunAt(run, SUNDAY_CFG);
    }
    expect(new Set(seen).size).toBe(seen.length); // no date decided twice
    // Contiguous: consecutive entries are never more than 3 days apart (Fri → Mon).
    for (let i = 1; i < seen.length; i++) {
      const gap = (parseCalendarDate(seen[i]).getTime() - parseCalendarDate(seen[i - 1]).getTime()) / (24 * 3600 * 1000);
      expect(gap).toBeLessThanOrEqual(3);
    }
  });
});

describe('upcomingAllocationBand (what a manual "run the batch" click must process)', () => {
  it('is the band of the NEXT run, not of "now"', () => {
    // Anchoring on `now` (a Monday) would yield the stale [06 Aug, 12 Aug) band — dates that closed
    // for requests days ago — and would decide none of this week's actual requests.
    expect(allocationBand(MONDAY_MORNING, SUNDAY_CFG).from).toBe('2026-08-06'); // the stale answer
    expect(upcomingAllocationBand(MONDAY_MORNING, SUNDAY_CFG)).toEqual(
      allocationBand(new Date('2026-08-09T14:30:00.000Z'), SUNDAY_CFG),
    );
  });

  it('starts exactly where the request window starts, so the batch decides what is open', () => {
    for (const weeks of [2, 4] as const) {
      for (const runDay of ['SATURDAY', 'SUNDAY'] as const) {
        for (const lead of [1, 3, 6]) {
          const c = cfg({ windowWeeks: weeks, runDay, approvalLeadDays: lead });
          expect(upcomingAllocationBand(MONDAY_MORNING, c).from).toBe(
            toIsoDate(earliestRequestableDate(MONDAY_MORNING, c)),
          );
        }
      }
    }
  });

  it('covers every date a user can currently request', () => {
    const band = upcomingAllocationBand(MONDAY_MORNING, SUNDAY_CFG);
    for (const d of requestableDates(MONDAY_MORNING, SUNDAY_CFG)) {
      expect(band.dates).toContain(d);
    }
  });
});

describe('bookingWindowSummary', () => {
  it('packages the next run, countdown and open dates for the client', () => {
    const s = bookingWindowSummary(MONDAY_MORNING, SUNDAY_CFG, SCORING);
    expect(s).toMatchObject({
      nextRunAt: '2026-08-09T14:30:00.000Z',
      requestCloseAt: '2026-08-09T13:30:00.000Z',
      resultsRunAt: '2026-08-09T14:30:00.000Z',
      runDay: 'SUNDAY',
      runTime: '20:00',
      windowWeeks: 2,
      approvalLeadDays: 3,
      earliestDate: '2026-08-12',
      latestDate: '2026-08-17',
    });
    // Mon 10:00 IST → Sun 20:00 IST is 6 days 10 hours.
    expect(s.nextRunCountdownSeconds).toBe(6 * 86400 + 10 * 3600);
    expect(s.requestCloseCountdownSeconds).toBe(6 * 86400 + 9 * 3600);
    expect(s.requestableDates).toHaveLength(4);
  });

  it('echoes the live scoring coefficients so the client can score before submitting (P8-04)', () => {
    // Passed in, never read from config here — this module stays pure, which is what lets every test
    // above be plain arithmetic with no database.
    const s = bookingWindowSummary(MONDAY_MORNING, SUNDAY_CFG, SCORING);
    expect(s.scoring).toEqual(SCORING);

    const retuned = { distanceWeight: 0.3, carpoolWeight: 0.7, maxDistanceKm: 25, maxPeople: 5 };
    expect(bookingWindowSummary(MONDAY_MORNING, SUNDAY_CFG, retuned).scoring).toEqual(retuned);
  });
});

describe('the shipped default lead time (D21)', () => {
  it('is 1 day, so a Sunday can request the Monday straight after the run', () => {
    // The requirement this phase exists for: "today is Sunday, I want Mon–Fri". With the old 3-day
    // lead the earliest requestable date on a Sunday was Wednesday, so Mon/Tue were unreachable
    // before the queue was even consulted.
    expect(DEFAULT_WINDOW_CONFIG.approvalLeadDays).toBe(1);

    const sundayNoon = new Date('2026-08-09T06:30:00.000Z'); // Sun 09 Aug, 12:00 IST — run is 20:00
    expect(toIsoDate(earliestRequestableDate(sundayNoon, DEFAULT_WINDOW_CONFIG))).toBe('2026-08-10');

    // …and that evening's run owns exactly that week's Mon–Fri.
    const band = upcomingAllocationBand(sundayNoon, DEFAULT_WINDOW_CONFIG);
    expect(band.dates).toEqual(['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14']);
  });

  it('still refuses the same Monday once that run has passed', () => {
    // 21:00 IST Sunday — the 20:00 run has fired, so Monday belongs to a decided band and the window
    // has moved on to the following week. The lead-time promise holds in both directions.
    const sundayNight = new Date('2026-08-09T15:30:00.000Z');
    expect(checkRequestable('2026-08-10', sundayNight, DEFAULT_WINDOW_CONFIG)).toMatchObject({
      ok: false,
      code: 'TOO_SOON',
    });
  });
});
