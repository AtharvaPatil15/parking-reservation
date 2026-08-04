import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import {
  API,
  bearer,
  blockQuotaDownTo,
  futureBookableDate,
  login,
  resetTransactional,
} from './integration/helpers';

/**
 * Phase 8 end-to-end: the **request queue**, and score-decided allocation.
 *
 * Phase 7 capped demand at submit time (D12), which made the scoring engine decorative: because
 * demand could never exceed supply, every request was allocated and nobody was ever waitlisted. The
 * guarantee under test here is the opposite one (D18): a request is a *queue entry* that consumes no
 * capacity, and the weekly run decides who wins **by score** — regardless of who asked first.
 *
 * The first test in this file is the whole phase. It is impossible to pass under Phase 7.
 */

const DATE = futureBookableDate();
const dateUtc = new Date(`${DATE}T00:00:00.000Z`);

// Seeded distances drive the score, so the expected ranking is fixed. Solo (people = 1 →
// carpoolScore 0), with the seeded weights 0.60/0.40 and maxDistanceKm 40:
//   Sara  38.1 km → distanceScore 95.25 → finalScore 57.15   (best)
//   Rahul 24.8 km → distanceScore 62.00 → finalScore 37.20
//   Aditi 12.4 km → distanceScore 31.00 → finalScore 18.60   (worst)
const ADITI = 'aditi@assent.example';
const RAHUL = 'rahul@assent.example';
const SARA = 'sara@assent.example';
const SA = 'superadmin@redbricks.example';

const SOLO_SCORE = { [SARA]: 57.15, [RAHUL]: 37.2, [ADITI]: 18.6 } as const;

async function companyIdOf(email: string): Promise<string> {
  const user = await prisma.user.findFirstOrThrow({ where: { email } });
  return user.companyId;
}

async function book(email: string, date = DATE, body: Record<string, unknown> = {}) {
  const token = await login(email);
  return request(app)
    .post(`${API}/bookings`)
    .set(bearer(token))
    .send({ bookingDate: date, vehicleType: 'CAR', carpoolPeople: 1, ...body });
}

/** Book and assert acceptance — under Phase 8 a request is never refused for want of capacity. */
async function queueOk(email: string, date = DATE, body: Record<string, unknown> = {}): Promise<void> {
  const res = await book(email, date, body);
  if (res.status !== 201) {
    throw new Error(`expected 201 queueing ${email} on ${date}, got ${res.status} ${JSON.stringify(res.body)}`);
  }
}

/** Status of a user's PRIMARY request for `date`, as the allocation run left it. */
async function statusOf(email: string, date = DATE): Promise<string | null> {
  const row = await prisma.bookingRequest.findFirst({
    where: { user: { email }, bookingDate: new Date(`${date}T00:00:00.000Z`), bookingType: 'PRIMARY' },
    select: { status: true },
  });
  return row?.status ?? null;
}

/**
 * Trigger the primary run and assert it completed.
 *
 * Not `.expect()`-chainable on purpose: this is an async function, so `runPrimary().expect(200)` reads
 * fine and then throws a TypeError on a Promise — *after* the request has already been dispatched,
 * which leaks a COMPLETED run into the next test and 422s its bookings. Returning the resolved
 * response makes that mistake impossible to write.
 */
async function runPrimary(date = DATE) {
  const sa = await login(SA);
  const res = await request(app)
    .post(`${API}/allocation/primary/run`)
    .set(bearer(sa))
    .send({ bookingDate: date });
  if (res.status !== 200) {
    throw new Error(`primary run for ${date} failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res;
}

/** Squeeze Assent's capacity for `date` down to `leave` slots without touching the quota. */
async function squeezeTo(leave: number, date = DATE): Promise<void> {
  const sa = await login(SA);
  await blockQuotaDownTo(sa, await companyIdOf(ADITI), date, leave);
}

beforeEach(async () => {
  await resetTransactional();
});

describe('the request queue replaces first-come-first-serve (D18)', () => {
  it('lets the best-scoring request win even though it was submitted LAST', async () => {
    await squeezeTo(2);

    // Ascending submission order, descending need. Under Phase 7 the third call was refused with
    // CAPACITY_FULL and Aditi kept a slot purely for having clicked first.
    await queueOk(ADITI); // 18.60 — nearest, asked first
    await queueOk(RAHUL); // 37.20
    await queueOk(SARA); //  57.15 — furthest, asked last

    const run = await runPrimary();
    expect(run.body.data.allocatedCount).toBe(2);
    expect(run.body.data.waitlistedCount).toBe(1);

    // Score decides, submission order does not.
    expect(await statusOf(SARA)).toBe('ALLOCATED');
    expect(await statusOf(RAHUL)).toBe('ALLOCATED');
    expect(await statusOf(ADITI)).toBe('WAITLISTED');

    // Nobody is ever REJECTED — the overflow outcome stays WAITLISTED (D19).
    expect(await prisma.bookingRequest.count({ where: { bookingDate: dateUtc, status: 'REJECTED' } })).toBe(0);
  });

  it('accepts every request past capacity instead of refusing at submit time', async () => {
    await squeezeTo(1);

    // Three requests for one slot, all accepted. No CAPACITY_FULL exists any more.
    for (const email of [ADITI, RAHUL, SARA]) {
      const res = await book(email);
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('SUBMITTED');
    }

    expect(
      await prisma.bookingRequest.count({ where: { bookingDate: dateUtc, status: 'SUBMITTED' } }),
    ).toBe(3);
  });

  it('scores and explains every request it considered, winners and losers alike', async () => {
    await squeezeTo(2);
    await queueOk(ADITI);
    await queueOk(RAHUL);
    await queueOk(SARA);

    const runRes = await runPrimary();
    const sa = await login(SA);
    const breakdown = await request(app)
      .get(`${API}/allocation/runs/${runRes.body.data.id}/breakdown`)
      .set(bearer(sa))
      .expect(200);

    // A row for all three, ranked best-first — the waitlisted user must be explainable too.
    const results = breakdown.body.data.results as Array<{
      rank: number;
      user: string;
      finalScore: number;
      outcome: string;
      slotNumber: string | null;
    }>;
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.user)).toEqual(['Sara Khan', 'Rahul Mehta', 'Aditi Rao']);
    expect(results.map((r) => r.finalScore)).toEqual([
      SOLO_SCORE[SARA],
      SOLO_SCORE[RAHUL],
      SOLO_SCORE[ADITI],
    ]);
    expect(results.map((r) => r.outcome)).toEqual(['ALLOCATED', 'ALLOCATED', 'WAITLISTED']);
    // The loser carries no slot but is still fully explained.
    expect(results[2].slotNumber).toBeNull();
  });

  it('lets a full car beat a longer solo commute — the carpool weight finally bites', async () => {
    await squeezeTo(1);

    // Aditi is the NEAREST user (12.4 km → solo 18.60), but fills her car with three scored
    // colleagues: people = 4 → carpoolScore 100 → finalScore 0.6*31 + 0.4*100 = 58.60, which beats
    // Sara's solo 57.15. Members must be same-company active employees to score at all (F4).
    await queueOk(ADITI, DATE, {
      carpoolPeople: 4,
      carpoolMembers: [
        { name: 'Rahul Mehta', employeeEmail: RAHUL },
        { name: 'Sara Khan', employeeEmail: SARA },
        { name: 'Assent Company Admin', employeeEmail: 'admin@assent.example' },
      ],
    });

    const aditiOnly = await runPrimary();
    expect(aditiOnly.body.data.allocatedCount).toBe(1);
    expect(await statusOf(ADITI)).toBe('ALLOCATED');

    const score = await prisma.bookingRequest.findFirstOrThrow({
      where: { user: { email: ADITI }, bookingDate: dateUtc },
      select: { allocationScore: true },
    });
    expect(Number(score.allocationScore)).toBeCloseTo(58.6, 4);
  });
});

describe('the availability grid tells the truth in both phases (D22)', () => {
  it('shows demand as a count and capacity as boxes while the date is still OPEN', async () => {
    await squeezeTo(2);
    await queueOk(ADITI);
    await queueOk(RAHUL);

    const res = await request(app).get(`${API}/availability`).set(bearer(await login(SARA))).expect(200);
    const day = res.body.data.days.find((d: { date: string }) => d.date === DATE);

    expect(day.phase).toBe('OPEN');
    expect(day.quota).toBe(12);
    expect(day.blocked).toBe(10);
    expect(day.requestCount).toBe(2); // demand is visible…
    expect(day.allocatedCount).toBe(0);
    expect(day.requestable).toBe(true); // …and never closes the date

    // …but it consumes no box: only green and grey-dotted exist before the run.
    const states = day.boxes.map((b: { state: string }) => b.state);
    expect(states).toHaveLength(12);
    expect(states.filter((s: string) => s === 'AVAILABLE')).toHaveLength(2);
    expect(states.filter((s: string) => s === 'BLOCKED')).toHaveLength(10);
    expect(states).not.toContain('TAKEN');
    expect(states).not.toContain('MINE');
  });

  it('never reports a date as FULL, however many people are queued', async () => {
    await squeezeTo(1);
    await queueOk(ADITI);
    await queueOk(RAHUL);
    await queueOk(SARA);

    const res = await request(app).get(`${API}/availability`).set(bearer(await login(SA))).expect(200);
    for (const day of res.body.data.days) {
      expect(day.reason).not.toBe('FULL');
    }

    // Assent's own view: three requests against one slot, still requestable for a fourth person.
    const ca = await request(app).get(`${API}/availability`).set(bearer(await login('admin@assent.example')));
    const day = ca.body.data.days.find((d: { date: string }) => d.date === DATE);
    expect(day.requestCount).toBe(3);
    expect(day.reason).toBeNull();
    expect(day.requestable).toBe(true);
  });

  it('switches to DECIDED after the run, with real slot numbers for the winner', async () => {
    await squeezeTo(2);
    await queueOk(ADITI);
    await queueOk(RAHUL);
    await queueOk(SARA);
    await runPrimary();

    // The winner sees their own slot highlighted, with the physical slot number.
    const winner = await request(app).get(`${API}/availability`).set(bearer(await login(SARA))).expect(200);
    const winnerDay = winner.body.data.days.find((d: { date: string }) => d.date === DATE);
    expect(winnerDay.phase).toBe('DECIDED');
    expect(winnerDay.allocatedCount).toBe(2);
    expect(winnerDay.myStatus).toBe('ALLOCATED');
    expect(winnerDay.mySlotNumber).toBeTruthy();

    const mine = winnerDay.boxes.filter((b: { state: string }) => b.state === 'MINE');
    expect(mine).toHaveLength(1);
    expect(mine[0].slotNumber).toBe(winnerDay.mySlotNumber);
    expect(winnerDay.boxes.filter((b: { state: string }) => b.state === 'TAKEN')).toHaveLength(1);
    expect(winnerDay.boxes).toHaveLength(12); // still exactly quota wide (D14)

    // The waitlisted user has no box of their own, and is told so.
    const loser = await request(app).get(`${API}/availability`).set(bearer(await login(ADITI))).expect(200);
    const loserDay = loser.body.data.days.find((d: { date: string }) => d.date === DATE);
    expect(loserDay.phase).toBe('DECIDED');
    expect(loserDay.myStatus).toBe('WAITLISTED');
    expect(loserDay.mySlotNumber).toBeNull();
    expect(loserDay.boxes.filter((b: { state: string }) => b.state === 'MINE')).toHaveLength(0);
    expect(loserDay.boxes.filter((b: { state: string }) => b.state === 'TAKEN')).toHaveLength(2);
  });

  it('exposes the live scoring weights so the client can show a score before submitting', async () => {
    const res = await request(app).get(`${API}/availability`).set(bearer(await login(ADITI))).expect(200);
    expect(res.body.data.window.scoring).toEqual({
      distanceWeight: 0.6,
      carpoolWeight: 0.4,
      maxDistanceKm: 40,
      maxPeople: 4,
    });
  });
});

describe('a booking needs a scoreable profile (P8-02)', () => {
  // `resetTransactional` only clears transactional rows, so a nulled profile would leak into every
  // later test in the run and 400 their bookings. Restore the seeded distance explicitly.
  afterEach(async () => {
    await prisma.user.updateMany({ where: { email: ADITI }, data: { distanceKm: 12.4 } });
  });

  it('refuses to queue a request when the user has no home → office distance', async () => {
    await prisma.user.updateMany({ where: { email: ADITI }, data: { distanceKm: null } });

    const res = await book(ADITI);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].field).toBe('distanceKm');
    expect(res.body.error.details[0].message).toMatch(/profile/i);
  });

  it('reports it once for a whole batch rather than per date', async () => {
    await prisma.user.updateMany({ where: { email: ADITI }, data: { distanceKm: null } });
    const token = await login(ADITI);

    const res = await request(app)
      .post(`${API}/bookings/batch`)
      .set(bearer(token))
      .send({
        bookingDates: [futureBookableDate(0), futureBookableDate(1), futureBookableDate(2)],
        vehicleType: 'CAR',
        carpoolPeople: 1,
      });

    // One clear 400 for the request, not three identical per-date failures.
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('distanceKm');
  });
});

/**
 * The primary waitlist feeding the common pool is the one path Phase 8 makes *live* without changing a
 * line of it. Before D18 the waitlist was always empty — submit-time capping guaranteed
 * demand <= quota — so this code has never run against real data. Asserted here for the first time.
 */
describe('a waitlisted user is picked up by the common-pool run', () => {
  // Quota rows are not transactional data, so `resetTransactional` will not remove one we add.
  afterEach(async () => {
    await prisma.commonPoolSlot.deleteMany({});
    await prisma.companySlotAllocation.deleteMany({ where: { id: 'test-quota-redbricks' } });
  });

  /** Give the building company unused quota, which is what the common pool is built out of. */
  async function lendRedbricksQuota(slotCount: number): Promise<string> {
    const redbricks = await prisma.company.findFirstOrThrow({ where: { code: 'REDBRICKS' } });
    const sa = await prisma.user.findFirstOrThrow({ where: { email: SA } });
    await prisma.companySlotAllocation.create({
      data: {
        id: 'test-quota-redbricks',
        companyId: redbricks.id,
        slotCount,
        effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
        createdById: sa.id,
      },
    });
    return redbricks.id;
  }

  it('re-ranks the primary waitlist across companies and places them in another company\'s spare slots', async () => {
    // Assent has ONE slot, three people want it: Sara wins on score, Rahul and Aditi are waitlisted.
    await squeezeTo(1);
    await queueOk(ADITI);
    await queueOk(RAHUL);
    await queueOk(SARA);
    await runPrimary();

    expect(await statusOf(SARA)).toBe('ALLOCATED');
    expect(await statusOf(RAHUL)).toBe('WAITLISTED');
    expect(await statusOf(ADITI)).toBe('WAITLISTED');

    // Redbricks has one slot nobody asked for. That is the entire point of the common pool: it should
    // cross the company boundary rather than sit empty while Assent has people waiting.
    const redbricksId = await lendRedbricksQuota(1);

    const sa = await login(SA);
    await request(app)
      .post(`${API}/allocation/common-pool/run`)
      .set(bearer(sa))
      .send({ bookingDate: DATE })
      .expect(200);

    // Both waitlisted users were enrolled as COMMON_POOL requests without asking again…
    const cp = await prisma.bookingRequest.findMany({
      where: { bookingDate: dateUtc, bookingType: 'COMMON_POOL' },
      select: { status: true, user: { select: { email: true } } },
    });
    expect(cp.map((r) => r.user.email).sort()).toEqual([ADITI, RAHUL].sort());

    // …and the single spare slot went to the BETTER-scoring one of them (Rahul 37.20 > Aditi 18.60),
    // ranked across companies, not by who was waitlisted first.
    const byEmail = new Map(cp.map((r) => [r.user.email, r.status]));
    expect(byEmail.get(RAHUL)).toBe('ALLOCATED');
    expect(byEmail.get(ADITI)).toBe('WAITLISTED');

    // The allocation is typed COMMON_POOL and the pool slot is credited to whoever lent it.
    const alloc = await prisma.parkingAllocation.findFirstOrThrow({
      where: { bookingDate: dateUtc, allocationType: 'COMMON_POOL' },
      select: { companyId: true, bookingRequest: { select: { user: { select: { email: true } } } } },
    });
    expect(alloc.bookingRequest.user.email).toBe(RAHUL);
    expect(alloc.companyId).not.toBe(redbricksId); // recorded against the HOLDER, not the lender

    const poolSlots = await prisma.commonPoolSlot.findMany({
      where: { bookingDate: dateUtc },
      select: { status: true, sourceCompanyId: true },
    });
    expect(poolSlots).toHaveLength(1);
    expect(poolSlots[0]).toMatchObject({ status: 'ALLOCATED', sourceCompanyId: redbricksId });

    // Rahul now holds a WAITLISTED primary row AND an ALLOCATED common-pool row for the same day, so
    // the grid must report the outcome that matters. This is exactly why `myStatus` takes the best of
    // the two rather than the first one found.
    expect(await statusOf(RAHUL)).toBe('WAITLISTED'); // his PRIMARY row, untouched
    const grid = await request(app).get(`${API}/availability`).set(bearer(await login(RAHUL))).expect(200);
    const day = grid.body.data.days.find((d: { date: string }) => d.date === DATE);
    expect(day.myStatus).toBe('ALLOCATED');
    expect(day.mySlotNumber).toBeTruthy();
    // …but it contributes no box to Assent's grid: the slot came out of Redbricks' quota (§5.3).
    expect(day.boxes.filter((b: { state: string }) => b.state === 'MINE')).toHaveLength(0);
    expect(day.boxes).toHaveLength(12);
  });

  it('leaves the waitlist alone when no company has a spare slot', async () => {
    await squeezeTo(1);
    await queueOk(ADITI);
    await queueOk(SARA);
    await runPrimary();

    // No lent quota this time, so the pool is empty.
    const sa = await login(SA);
    await request(app)
      .post(`${API}/allocation/common-pool/run`)
      .set(bearer(sa))
      .send({ bookingDate: DATE })
      .expect(200);

    expect(await prisma.commonPoolSlot.count({ where: { bookingDate: dateUtc } })).toBe(0);
    expect(
      await prisma.parkingAllocation.count({ where: { bookingDate: dateUtc, allocationType: 'COMMON_POOL' } }),
    ).toBe(0);
    // Aditi is enrolled and still waiting — never rejected (D19).
    const cp = await prisma.bookingRequest.findFirstOrThrow({
      where: { bookingDate: dateUtc, bookingType: 'COMMON_POOL', user: { email: ADITI } },
      select: { status: true },
    });
    expect(cp.status).toBe('WAITLISTED');
  });
});

describe('an under-provisioned building fails loudly instead of starving a tenant (P8-05b)', () => {
  // Slots are seeded data, not transactional, so `resetTransactional` will not put them back.
  afterEach(async () => {
    await prisma.parkingSlot.updateMany({ data: { status: 'AVAILABLE' } });
  });

  it('refuses the run when there are fewer usable slots than the quota promises', async () => {
    // Two people, quota for both, but only ONE physical slot in service. Companies are walked in a
    // fixed order sharing one cursor over the slot pool, so silently allocating would give the slot to
    // whoever sorted first and hand the other candidate nothing — for no reason a Super Admin could
    // ever discover. Fail, and say what is short.
    await queueOk(ADITI);
    await queueOk(RAHUL);

    const spare = await prisma.parkingSlot.findMany({ select: { id: true }, orderBy: { slotNumber: 'asc' } });
    await prisma.parkingSlot.updateMany({
      where: { id: { in: spare.slice(1).map((s) => s.id) } },
      data: { status: 'UNDER_MAINTENANCE' },
    });

    const sa = await login(SA);
    const res = await request(app)
      .post(`${API}/allocation/primary/run`)
      .set(bearer(sa))
      .send({ bookingDate: DATE });

    expect(res.status).toBe(500); // a misconfigured building is an operator problem, not a user one
    const run = await prisma.allocationRun.findFirstOrThrow({
      where: { runType: 'PRIMARY', bookingDate: dateUtc },
      select: { status: true, error: true },
    });
    expect(run.status).toBe('FAILED');
    expect(run.error).toMatch(/1 assignable, but 2 needed/);
    expect(run.error).toMatch(/Add slots or reduce company quotas/);

    // The transaction rolled back cleanly, so a re-run after fixing quotas starts fresh.
    expect(await prisma.parkingAllocation.count({ where: { bookingDate: dateUtc } })).toBe(0);
    expect(await prisma.allocationScoreBreakdown.count()).toBe(0);
    expect(await statusOf(ADITI)).toBe('SUBMITTED');
    expect(await statusOf(RAHUL)).toBe('SUBMITTED');
  });
});

describe('allocation never exceeds a company quota (P8-05)', () => {
  it('counts allocations the company already holds when re-running a date', async () => {
    await squeezeTo(2);
    await queueOk(ADITI);
    await queueOk(RAHUL);
    await queueOk(SARA);
    await runPrimary();

    const assentId = await companyIdOf(ADITI);
    const before = await prisma.parkingAllocation.count({ where: { companyId: assentId, bookingDate: dateUtc } });
    expect(before).toBe(2);

    // Release the winner's slot: the cascade hands it straight to the own-company waitlist, so the
    // company still holds exactly 2 — and a forced re-run must not push it to 3.
    const sara = await prisma.bookingRequest.findFirstOrThrow({
      where: { user: { email: SARA }, bookingDate: dateUtc },
      select: { id: true },
    });
    await request(app)
      .post(`${API}/bookings/${sara.id}/release`)
      .set(bearer(await login(SARA)))
      .send({ reason: 'testing' })
      .expect(200);

    // Clear the run so the idempotency short-circuit does not hide the quota arithmetic.
    await prisma.allocationRun.updateMany({
      where: { runType: 'PRIMARY', bookingDate: dateUtc },
      data: { status: 'PENDING' },
    });
    await runPrimary();

    expect(
      await prisma.parkingAllocation.count({ where: { companyId: assentId, bookingDate: dateUtc } }),
    ).toBeLessThanOrEqual(2);
  });
});
