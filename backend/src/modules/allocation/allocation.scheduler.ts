import { logger } from '../../lib/logger';
import { currentIstCalendarDate } from '../bookings/bookings.time';
import { commonPoolRunAtFor, nextAllocationRunAt, toIsoDate } from '../bookings/bookings.window';
import { loadWindowConfig } from '../bookings/bookings.windowConfig';
import { runWeeklyAllocation, runWeeklyCommonPoolAllocation } from './allocation.service';

/**
 * Automatic allocation scheduler.
 *
 * MERGE NOTE (Phase 7): this originally fired `runPrimaryAllocation(tomorrow)` every minute once the
 * clock passed `booking.primaryResultsBy` — the nightly "decide tomorrow tonight" model. That is
 * incompatible with the phase's core promise (D11): a date must be decided at least
 * `booking.approvalLeadDays` days ahead so a user who misses out still has time to arrange another way
 * in, and one day of notice breaks exactly that. It would also mean two different triggers deciding
 * dates on two different schedules.
 *
 * It now fires the **weekly weekend batch** on the configured `booking.allocationRunDay` at
 * `booking.allocationRunTime`, which is the same thing the Super Admin's button does — so the
 * automatic and manual paths cannot diverge. The common-pool half then fires on the same day at
 * `booking.commonPoolRunTime`, which defaults to the same instant (both in one tick) but can be pushed
 * later to leave a release window between the two.
 *
 * Both halves are anchored on the primary slot they belong to, never on the fire time: see the
 * `runInstant` note on `runWeeklyAllocation`.
 */

const TICK_MS = 60_000;

let timer: NodeJS.Timeout | null = null;
let running = false;
/**
 * IST calendar date of the last completed batch, tracked per half — the runs are idempotent, this just
 * avoids re-querying the whole band every minute for the rest of the run day.
 *
 * Two separate guards, not one: with a later `commonPoolRunTime` the halves fire on different ticks, and
 * a shared guard would let the primary tick mark the day done and suppress the pool entirely.
 */
let lastPrimaryIstDate: string | null = null;
let lastPoolIstDate: string | null = null;

/** Exposed for tests: forget the once-per-day guards. */
export function resetSchedulerState(): void {
  lastPrimaryIstDate = null;
  lastPoolIstDate = null;
}

/**
 * True when `now` is at or past this week's scheduled run instant on the configured run day.
 *
 * Derived by asking for the *next* run and stepping back a week: `nextAllocationRunAt` treats an
 * instant exactly at the run as already under way, so the previous occurrence is this week's slot.
 */
async function dueRunInstant(now: Date): Promise<Date | null> {
  const cfg = await loadWindowConfig();
  const next = nextAllocationRunAt(now, cfg);
  const thisWeek = new Date(next.getTime() - 7 * 24 * 60 * 60 * 1000);
  return now.getTime() >= thisWeek.getTime() ? thisWeek : null;
}

async function tick(now = new Date()): Promise<void> {
  if (running) return;
  running = true;
  try {
    const cfg = await loadWindowConfig();
    const due = await dueRunInstant(now);
    if (!due) return;

    const today = toIsoDate(currentIstCalendarDate(now));
    // Only the run day's own slot counts: `due` is always on the configured day, so if it is not
    // today then this week's run already happened on an earlier day and is done.
    if (toIsoDate(currentIstCalendarDate(due)) !== today) return;

    if (lastPrimaryIstDate !== today) {
      // `due`, not `now`: the batch must decide the band belonging to the slot it is fulfilling. Anchored
      // on the fire time it would skip a week, because "the next run" is already next week's by then.
      const result = await runWeeklyAllocation(undefined, now, due);
      lastPrimaryIstDate = today;
      logger.info(
        {
          band: `${result.band.from}..${result.band.toExclusive}`,
          dates: result.dates.length,
          allocated: result.totalAllocated,
          waitlisted: result.totalWaitlisted,
        },
        'Weekly allocation batch completed automatically',
      );
    }

    // Hand any leftover waitlist for those dates to the common pool. Its own slot on the same run day,
    // so a configured gap between the two is honoured; equal times mean this runs in the same tick,
    // straight after primary. Anchored on `due` (primary's slot) because the pool decides primary's band.
    const poolDue = commonPoolRunAtFor(due, cfg);
    if (lastPoolIstDate !== today && now.getTime() >= poolDue.getTime()) {
      // Same band-scoped call the Super Admin's "Run common pool" button makes, so the automatic and
      // manual paths cannot drift: a per-date loop here was how they diverged before.
      const pool = await runWeeklyCommonPoolAllocation(undefined, now, due);
      lastPoolIstDate = today;
      logger.info(
        {
          band: `${pool.band.from}..${pool.band.toExclusive}`,
          allocated: pool.totalAllocated,
          stillWaitlisted: pool.totalWaitlisted,
          failed: pool.dates.filter((d) => d.status === 'FAILED').map((d) => d.bookingDate),
        },
        'Automatic common-pool batch completed',
      );
    }
  } catch (error) {
    logger.error({ err: error }, 'Automatic allocation scheduler tick failed');
  } finally {
    running = false;
  }
}

export function startAllocationScheduler(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), TICK_MS);
  void tick();
  logger.info('Automatic allocation scheduler started (weekly batch)');
}

export function stopAllocationScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  logger.info('Automatic allocation scheduler stopped');
}

/** Exposed for tests. */
export const __tickForTest = tick;
