import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { __tickForTest, resetSchedulerState } from '../src/modules/allocation/allocation.scheduler';
import { getWeeklyRunPreview } from '../src/modules/allocation/allocation.service';
import {
  API,
  bearer,
  blockQuotaDownTo,
  futureBookableDate,
  login,
  resetTransactional,
} from './integration/helpers';

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

const USER = 'sara';
/** Scores lower than USER, so primary waitlists them and the pool has somebody to place. */
const RUNNER_UP = 'rahul';
const SA = 'superadmin';

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

async function queue(email = USER, date = DATE): Promise<void> {
  const token = await login(email);
  const res = await request(app)
    .post(`${API}/bookings`)
    .set(bearer(token))
    .send({ bookingDate: date, vehicleType: 'CAR', carpoolPeople: 1 });
  if (res.status !== 201) {
    throw new Error(`queueing ${email} on ${date} failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

/** Set config through the API — the only path that invalidates the process-wide config cache. */
async function setConfig(patch: Record<string, string>): Promise<void> {
  const sa = await login(SA);
  const res = await request(app).patch(`${API}/config`).set(bearer(sa)).send(patch);
  if (res.status !== 200) {
    throw new Error(`config patch failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

async function commonPoolRunStatus(date: string): Promise<string | null> {
  const row = await prisma.allocationRun.findUnique({
    where: {
      runType_bookingDate: { runType: 'COMMON_POOL', bookingDate: new Date(`${date}T00:00:00.000Z`) },
    },
    select: { status: true },
  });
  return row?.status ?? null;
}

/**
 * Squeeze Assent to one slot and give the building company a spare, so primary must waitlist somebody
 * and the pool has real cross-company inventory to place them in. Quota rows are not transactional data,
 * so the lent row is removed explicitly.
 */
async function forcePoolScenario(): Promise<void> {
  const sa = await login(SA);
  const assent = await prisma.user.findFirstOrThrow({ where: { email: USER }, select: { companyId: true } });
  await blockQuotaDownTo(sa, assent.companyId, DATE, 1);
  const redbricks = await prisma.company.findFirstOrThrow({ where: { code: 'REDBRICKS' } });
  const saUser = await prisma.user.findFirstOrThrow({ where: { email: SA } });
  await prisma.companySlotAllocation.create({
    data: {
      id: 'test-quota-redbricks-scheduler',
      companyId: redbricks.id,
      slotCount: 1,
      effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
      createdById: saUser.id,
    },
  });
}

beforeEach(async () => {
  await resetTransactional();
  resetSchedulerState();
});

afterEach(async () => {
  vi.useRealTimers();
  await prisma.commonPoolSlot.deleteMany({});
  await prisma.companySlotAllocation.deleteMany({ where: { id: 'test-quota-redbricks-scheduler' } });
  // Restore the seeded run times: the config cache is process-wide, so a leaked edit would follow the
  // rest of the suite into unrelated files — and a changed run time moves every test's booking window.
  await setConfig({ 'booking.allocationRunTime': '20:00', 'booking.commonPoolRunTime': '20:00' });
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

  it('runs the common pool over the same band, placing a waitlisted user without anyone pressing a button', async () => {
    await forcePoolScenario();
    await queue(USER); // higher score — wins Assent's single slot
    await queue(RUNNER_UP); // waitlisted by primary, then placed from the pool

    await tickAt(FIRE_AT);

    expect(await requestStatus(DATE)).toBe('ALLOCATED');
    expect(await commonPoolRunStatus(DATE)).toBe('COMPLETED');
    // The pool decided primary's band, not a band a week later — the bug this file exists for, in the
    // half that the scheduler used to call with no anchor at all.
    expect(await commonPoolRunStatus(NEXT_WEEK)).toBeNull();

    // Enrolled and placed automatically, in another company's spare slot.
    const pooled = await prisma.bookingRequest.findFirstOrThrow({
      where: { user: { email: RUNNER_UP }, bookingDate: new Date(`${DATE}T00:00:00.000Z`), bookingType: 'COMMON_POOL' },
      select: { status: true },
    });
    expect(pooled.status).toBe('ALLOCATED');
  });

  it('holds the pool back until its own configured time on the run day', async () => {
    await setConfig({ 'booking.commonPoolRunTime': '22:00' });
    await forcePoolScenario();
    await queue(USER);
    await queue(RUNNER_UP);

    // 20:05 IST — primary's slot has passed, the pool's has not.
    await tickAt(FIRE_AT);
    expect(await primaryRunStatus(DATE)).toBe('COMPLETED');
    expect(await commonPoolRunStatus(DATE)).toBeNull();

    // 22:00 IST the same day — the pool's own slot. Primary is guarded separately, so it does not
    // matter that it already ran; if the two shared one guard the pool would never fire at all.
    await tickAt(new Date(`${RUN_DATE}T16:30:00.000Z`));
    expect(await commonPoolRunStatus(DATE)).toBe('COMPLETED');
  });

  it('reports the decided band as `lastRun` on the weekly preview', async () => {
    await queue();
    await tickAt(FIRE_AT);

    // Asked as of just after the run — the moment the old preview showed an empty next-week band and
    // no trace of what had been decided.
    const preview = await getWeeklyRunPreview(FIRE_AT);

    expect(preview.lastRun.band.dates).toContain(DATE);
    // Contiguous by construction: no date in both bands, none in neither.
    expect(preview.lastRun.band.toExclusive).toBe(preview.band.from);
    expect(preview.band.dates).not.toContain(DATE);

    const row = preview.lastRun.dates.find((d) => d.bookingDate === DATE);
    expect(row).toMatchObject({ runStatus: 'COMPLETED', allocated: 1 });
  });

  it('does not fire before the slot arrives', async () => {
    await queue();

    // Sunday 19:59 IST — one minute short of the run.
    await tickAt(new Date(`${RUN_DATE}T14:29:00.000Z`));

    expect(await requestStatus(DATE)).toBe('SUBMITTED');
    expect(await primaryRunStatus(DATE)).toBeNull();
  });
});

describe('booking.commonPoolRunTime', () => {
  it('refuses a pool time earlier than the allocation run', async () => {
    const sa = await login(SA);
    const res = await request(app)
      .patch(`${API}/config`)
      .set(bearer(sa))
      .send({ 'booking.commonPoolRunTime': '19:00' }); // allocation runs at 20:00

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      expect.objectContaining({ field: 'booking.commonPoolRunTime' }),
    ]);
  });

  it('accepts a pair moved together, validating the merged view rather than each key alone', async () => {
    // 19:00 would be rejected against the stored 20:00 above; sent alongside a matching primary time it
    // is fine. Either half of the pair can be the one being edited, so the rule reads both.
    await setConfig({ 'booking.allocationRunTime': '18:00', 'booking.commonPoolRunTime': '19:00' });

    const sa = await login(SA);
    const rows = await request(app).get(`${API}/config`).set(bearer(sa)).expect(200);
    const byKey = new Map(
      (rows.body.data as Array<{ key: string; value: string }>).map((r) => [r.key, r.value]),
    );
    expect(byKey.get('booking.allocationRunTime')).toBe('18:00');
    expect(byKey.get('booking.commonPoolRunTime')).toBe('19:00');
  });
});
