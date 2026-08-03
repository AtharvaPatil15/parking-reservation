import { describe, it, expect } from 'vitest';
import {
  DEFAULT_WINDOW_CONFIG,
  nextAllocationRunAt,
  toIsoDate,
  upcomingAllocationBand,
  type WindowConfig,
} from '../src/modules/bookings/bookings.window';
import { currentIstCalendarDate } from '../src/modules/bookings/bookings.time';

/**
 * The scheduler's "is this week's run due?" rule (allocation.scheduler.ts), asserted against the pure
 * window helpers it is built from.
 *
 * This exists because the merge of PR #33 turned a nightly "decide tomorrow tonight" trigger into the
 * weekly batch: the old behaviour gave one day of notice and silently broke D11 (a date must be
 * decided >= approvalLeadDays ahead). These tests pin the property that made the change necessary.
 *
 * Anchor calendar (2026): Aug 3 MON · Aug 8 Sat · Aug 9 SUN 20:00 IST == 14:30Z · Aug 16 SUN.
 */

/** Mirrors `dueRunInstant` in the scheduler: this week's slot, or null when it has not arrived. */
function dueRunInstant(now: Date, cfg: WindowConfig): Date | null {
  const next = nextAllocationRunAt(now, cfg);
  const thisWeek = new Date(next.getTime() - 7 * 24 * 60 * 60 * 1000);
  return now.getTime() >= thisWeek.getTime() ? thisWeek : null;
}

/** Mirrors the scheduler's day guard. */
function firesNow(now: Date, cfg: WindowConfig): boolean {
  const due = dueRunInstant(now, cfg);
  if (!due) return false;
  return toIsoDate(currentIstCalendarDate(due)) === toIsoDate(currentIstCalendarDate(now));
}

const cfg = DEFAULT_WINDOW_CONFIG; // SUNDAY 20:00, 2 weeks, 3 days lead

describe('scheduler run-due rule', () => {
  it('does not fire on a weekday', () => {
    expect(firesNow(new Date('2026-08-03T04:30:00.000Z'), cfg)).toBe(false); // Mon 10:00 IST
    expect(firesNow(new Date('2026-08-06T14:30:00.000Z'), cfg)).toBe(false); // Thu 20:00 IST
  });

  it('does not fire on the run day before the run time', () => {
    // Sun 09 Aug 19:59 IST == 14:29Z.
    expect(firesNow(new Date('2026-08-09T14:29:00.000Z'), cfg)).toBe(false);
  });

  it('fires at exactly the run instant and for the rest of that IST day', () => {
    expect(firesNow(new Date('2026-08-09T14:30:00.000Z'), cfg)).toBe(true); // 20:00 IST
    expect(firesNow(new Date('2026-08-09T17:00:00.000Z'), cfg)).toBe(true); // 22:30 IST
  });

  it('stops firing once the IST day rolls over', () => {
    // 2026-08-09T18:30Z == Mon 10 Aug 00:00 IST — a new day, so this week's slot is behind us.
    expect(firesNow(new Date('2026-08-09T18:30:00.000Z'), cfg)).toBe(false);
  });

  it('honours a SATURDAY run day instead', () => {
    const sat = { ...cfg, runDay: 'SATURDAY' as const };
    expect(firesNow(new Date('2026-08-08T14:30:00.000Z'), sat)).toBe(true); // Sat 20:00 IST
    expect(firesNow(new Date('2026-08-09T14:30:00.000Z'), sat)).toBe(false); // Sunday is not its day
  });

  it('resolves the slot it fires for to the band the manual button would run', () => {
    const runInstant = new Date('2026-08-09T14:30:00.000Z');
    const due = dueRunInstant(runInstant, cfg);
    expect(due?.toISOString()).toBe(runInstant.toISOString());
    // Firing at the slot must decide the same dates the Super Admin's button decides beforehand.
    expect(upcomingAllocationBand(new Date('2026-08-03T04:30:00.000Z'), cfg).dates).toEqual([
      '2026-08-12',
      '2026-08-13',
      '2026-08-14',
      '2026-08-17',
      '2026-08-18',
    ]);
  });

  it('never decides a date with less than the configured lead time (the old nightly bug)', () => {
    // The replaced behaviour ran `runPrimaryAllocation(tomorrow)`: one day of notice.
    const runInstant = new Date('2026-08-09T14:30:00.000Z');
    const runDay = currentIstCalendarDate(runInstant);
    for (const date of upcomingAllocationBand(runInstant, cfg).dates) {
      const leadDays =
        (new Date(`${date}T00:00:00.000Z`).getTime() - runDay.getTime()) / (24 * 60 * 60 * 1000);
      expect(leadDays).toBeGreaterThanOrEqual(cfg.approvalLeadDays);
    }
  });
});
