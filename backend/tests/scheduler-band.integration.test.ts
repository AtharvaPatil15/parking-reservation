import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { __tickForTest, resetSchedulerState } from '../src/modules/allocation/allocation.scheduler';
import { API, bearer, futureBookableDate, login, resetTransactional } from './integration/helpers';

/**
 * The automatic scheduler decides the band it fired for.
 *
 * Regression for a bug that made the timer completely inert in production while every manual path
 * looked healthy: `tick()` called `runWeeklyAllocation()` with no anchor, so the band came from
 * `upcomingAllocationBand(fireTime)`. Since `nextAllocationRunAt` treats an instant exactly at the run
 * as already under way, and the scheduler by definition fires at or after its slot, the anchor had
 * rolled a week forward — the batch decided *next* week's dates, reported `status: COMPLETED` with 0
 * allocated, and left this week's queue at SUBMITTED forever. Unrecoverable without a manual per-date
 * run, because `earliestRequestableDate` had moved past those dates too.
 *
 * Driven by a faked `Date` rather than by mutating the run day/time into the past: the config cache is
 * process-wide and shared with every other integration file, and — more importantly — the bug lives in
 * the *default* `now = new Date()` inside `runWeeklyAllocation`, so merely passing an instant to
 * `tick(now)` does not reproduce it. Only `Date` is faked; timers stay real so Prisma's IO is untouched.
 * Requests are queued before the clock moves, since the window has by definition rolled past those
 * dates once the run instant passes.
 */

/** The first open date — with a SUNDAY run and a 1-day lead this is the Monday after the next run. */
const DATE = futureBookableDate();

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The run day owning `DATE`: the Sunday before it. */
const RUN_DATE = shiftDays(DATE, -1);
/** Five minutes past that Sunday's 20:00 IST slot — 20:00 IST is 14:30 UTC. */
const FIRE_AT = new Date(`${RUN_DATE}T14:35:00.000Z`);
/** First date of the band the *buggy* anchor produced. */
const NEXT_WEEK = shiftDays(DATE, 7);

const USER = 'sara@assent.example';

async function primaryRunStatus(date: string): Promise<string | null> {
  const row = await prisma.allocationRun.findUnique({
    where: { runType_bookingDate: { runType: 'PRIMARY', bookingDate: new Date(`${date}T00:00:00.000Z`) } },
    select: { status: true },
  });
  return row?.status ?? null;
}

async function requestStatus(date: string): Promise<string | null> {
  const row = await prisma.bookingRequest.findFirst({
    where: { user: { email: USER }, bookingDate: new Date(`${date}T00:00:00.000Z`), bookingType: 'PRIMARY' },
    select: { status: true },
  });
  return row?.status ?? null;
}

/**
 * Run one scheduler tick with the wall clock pinned to `instant`.
 *
 * The instant is passed to `tick` *and* installed as the system clock, because the two must agree: the
 * scheduler derives the due slot from its argument while the batch it calls falls back to `new Date()`.
 * Pinning both is what turns the anchor bug into a failing assertion instead of a silent pass.
 */
async function tickAt(instant: Date): Promise<void> {
  vi.useFakeTimers({ toFake: ['Date'], now: instant });
  try {
    await __tickForTest(instant);
  } finally {
    vi.useRealTimers();
  }
}

async function queue(date = DATE): Promise<void> {
  const token = await login(USER);
  const res = await request(app)
    .post(`${API}/bookings`)
    .set(bearer(token))
    .send({ bookingDate: date, vehicleType: 'CAR', carpoolPeople: 1 });
  if (res.status !== 201) {
    throw new Error(`queueing ${date} failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

beforeEach(async () => {
  await resetTransactional();
  resetSchedulerState();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('automatic weekly run (scheduler)', () => {
  it('decides the queue whose window just closed, not next week’s', async () => {
    await queue();
    expect(await requestStatus(DATE)).toBe('SUBMITTED');

    await tickAt(FIRE_AT);

    // The whole point: the request the closing window collected is decided by the run that closed it.
    expect(await requestStatus(DATE)).toBe('ALLOCATED');
    expect(await primaryRunStatus(DATE)).toBe('COMPLETED');
    // And the band did not skip forward — next week is still open for requests, so no run owns it yet.
    expect(await primaryRunStatus(NEXT_WEEK)).toBeNull();
  });

  it('is idempotent — a second tick on the same run day does not re-decide', async () => {
    await queue();

    await tickAt(FIRE_AT);
    const runId = (
      await prisma.allocationRun.findUniqueOrThrow({
        where: { runType_bookingDate: { runType: 'PRIMARY', bookingDate: new Date(`${DATE}T00:00:00.000Z`) } },
        select: { id: true },
      })
    ).id;
    const allocations = await prisma.parkingAllocation.count({ where: { bookingDate: new Date(`${DATE}T00:00:00.000Z`) } });

    // A later tick the same IST day: the once-per-day guard short-circuits, and even without it the
    // per-date run is idempotent.
    await tickAt(new Date(`${RUN_DATE}T17:00:00.000Z`));

    expect(await primaryRunStatus(DATE)).toBe('COMPLETED');
    expect(
      (
        await prisma.allocationRun.findUniqueOrThrow({
          where: { runType_bookingDate: { runType: 'PRIMARY', bookingDate: new Date(`${DATE}T00:00:00.000Z`) } },
          select: { id: true },
        })
      ).id,
    ).toBe(runId);
    expect(await prisma.parkingAllocation.count({ where: { bookingDate: new Date(`${DATE}T00:00:00.000Z`) } })).toBe(
      allocations,
    );
  });

  it('does not fire before the slot arrives', async () => {
    await queue();

    // Sunday 19:59 IST — one minute short of the run.
    await tickAt(new Date(`${RUN_DATE}T14:29:00.000Z`));

    expect(await requestStatus(DATE)).toBe('SUBMITTED');
    expect(await primaryRunStatus(DATE)).toBeNull();
  });
});
