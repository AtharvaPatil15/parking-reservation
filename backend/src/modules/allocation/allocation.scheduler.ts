import { logger } from '../../lib/logger';
import { currentIstCalendarDate } from '../bookings/bookings.time';
import { nextAllocationRunAt, toIsoDate } from '../bookings/bookings.window';
import { loadWindowConfig } from '../bookings/bookings.windowConfig';
import { runCommonPoolAllocation, runWeeklyAllocation } from './allocation.service';

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
 * automatic and manual paths cannot diverge. Common-pool then runs for the same band of dates,
 * preserving the original primary-then-common-pool pairing.
 */

const TICK_MS = 60_000;

let timer: NodeJS.Timeout | null = null;
let running = false;
/** IST calendar date of the last completed batch — the runs are idempotent, this just avoids
 *  re-querying the whole band every minute for the rest of the run day. */
let lastRunIstDate: string | null = null;

/** Exposed for tests: forget the once-per-day guard. */
export function resetSchedulerState(): void {
  lastRunIstDate = null;
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
    const due = await dueRunInstant(now);
    if (!due) return;

    const today = toIsoDate(currentIstCalendarDate(now));
    // Only the run day's own slot counts: `due` is always on the configured day, so if it is not
    // today then this week's run already happened on an earlier day and is done.
    if (toIsoDate(currentIstCalendarDate(due)) !== today) return;
    if (lastRunIstDate === today) return;

    const result = await runWeeklyAllocation();
    lastRunIstDate = today;
    logger.info(
      {
        band: `${result.band.from}..${result.band.toExclusive}`,
        dates: result.dates.length,
        allocated: result.totalAllocated,
        waitlisted: result.totalWaitlisted,
      },
      'Weekly allocation batch completed automatically',
    );

    // Hand any leftover waitlist for those dates to the common pool, as the nightly pairing did.
    for (const date of result.band.dates) {
      try {
        await runCommonPoolAllocation(date);
      } catch (error) {
        // One date failing must not stop the others — each run is independent and idempotent.
        logger.error({ err: error, bookingDate: date }, 'Automatic common-pool run failed for a date');
      }
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
