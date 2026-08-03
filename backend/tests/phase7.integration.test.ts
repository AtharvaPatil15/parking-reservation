import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
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
import { DEFAULT_WINDOW_CONFIG, requestableDates } from '../src/modules/bookings/bookings.window';

/**
 * Phase 7 end-to-end: the rolling booking window, the reserve-on-request slot grid, the weekly batch,
 * and the security gate.
 *
 * The guarantee under test is the whole point of the phase: because a request reserves capacity the
 * moment it is submitted (D12), demand can never exceed supply, so the scored run has nobody to
 * reject. The capacity test below asserts exactly that.
 */

const DATE = futureBookableDate();
const dateUtc = new Date(`${DATE}T00:00:00.000Z`);

const ASSENT_USERS = ['aditi@assent.example', 'rahul@assent.example', 'sara@assent.example'];

async function companyIdOf(email: string): Promise<string> {
  const user = await prisma.user.findFirstOrThrow({ where: { email } });
  return user.companyId;
}

async function book(email: string, date = DATE) {
  const token = await login(email);
  return request(app)
    .post(`${API}/bookings`)
    .set(bearer(token))
    .send({ bookingDate: date, vehicleType: 'CAR', carpoolPeople: 1 });
}

/** Book and assert it was accepted — `book()` is async, so it cannot be `.expect()`-chained. */
async function bookOk(email: string, date = DATE): Promise<void> {
  const res = await book(email, date);
  if (res.status !== 201) {
    throw new Error(`expected 201 booking ${email} on ${date}, got ${res.status} ${JSON.stringify(res.body)}`);
  }
}

beforeEach(async () => {
  await resetTransactional();
  await prisma.gateEvent.deleteMany({});
});

describe('GET /availability — the slot grid (Phase 7 §4)', () => {
  it('returns the open window with one box per quota slot', async () => {
    const token = await login(ASSENT_USERS[0]);
    const res = await request(app).get(`${API}/availability`).set(bearer(token));
    expect(res.status).toBe(200);

    const { window: win, days } = res.body.data;
    expect(win.windowWeeks).toBe(DEFAULT_WINDOW_CONFIG.windowWeeks);
    expect(win.approvalLeadDays).toBe(DEFAULT_WINDOW_CONFIG.approvalLeadDays);
    expect(win.runDay).toBe(DEFAULT_WINDOW_CONFIG.runDay);
    expect(win.requestableDates).toEqual(requestableDates(new Date(), DEFAULT_WINDOW_CONFIG));

    const day = days.find((d: { date: string }) => d.date === DATE);
    expect(day.quota).toBe(12); // seeded Assent quota → the 12 boxes of the requirement
    expect(day.boxes).toHaveLength(12);
    expect(day.available).toBe(12);
    expect(day.requestable).toBe(true);
    expect(day.boxes.every((b: { state: string }) => b.state === 'AVAILABLE')).toBe(true);
  });

  it('counts a live request as taken immediately, and marks the caller their own box (D12)', async () => {
    await bookOk(ASSENT_USERS[0]);

    const own = await request(app).get(`${API}/availability`).set(bearer(await login(ASSENT_USERS[0])));
    const ownDay = own.body.data.days.find((d: { date: string }) => d.date === DATE);
    expect(ownDay.taken).toBe(1);
    expect(ownDay.available).toBe(11);
    expect(ownDay.mine).toBe(true);
    expect(ownDay.boxes[0].state).toBe('MINE');
    // Their own date is closed to them — one request per person per date.
    expect(ownDay.requestable).toBe(false);
    expect(ownDay.reason).toBe('ALREADY_BOOKED');

    // A colleague sees the same slot as taken, but not as theirs.
    const other = await request(app).get(`${API}/availability`).set(bearer(await login(ASSENT_USERS[1])));
    const otherDay = other.body.data.days.find((d: { date: string }) => d.date === DATE);
    expect(otherDay.taken).toBe(1);
    expect(otherDay.mine).toBe(false);
    expect(otherDay.boxes[0].state).toBe('TAKEN');
    expect(otherDay.requestable).toBe(true);
  });

  it('shows blocked slots as grey and excludes them from availability', async () => {
    const sa = await login('superadmin@redbricks.example');
    const assentId = await companyIdOf(ASSENT_USERS[0]);
    await blockQuotaDownTo(sa, assentId, DATE, 10); // block 2 of 12

    const res = await request(app).get(`${API}/availability`).set(bearer(await login(ASSENT_USERS[0])));
    const day = res.body.data.days.find((d: { date: string }) => d.date === DATE);
    expect(day.blocked).toBe(2);
    expect(day.available).toBe(10);
    expect(day.boxes.filter((b: { state: string }) => b.state === 'BLOCKED')).toHaveLength(2);
    expect(day.boxes.filter((b: { state: string }) => b.state === 'AVAILABLE')).toHaveLength(10);
  });

  it('never exposes another company occupancy', async () => {
    // PTC does not exist in the seed, so use Redbricks: its own grid must not reflect Assent bookings.
    await bookOk(ASSENT_USERS[0]);
    const sa = await login('superadmin@redbricks.example');
    const res = await request(app).get(`${API}/availability`).set(bearer(sa));
    const day = res.body.data.days.find((d: { date: string }) => d.date === DATE);
    expect(day.taken).toBe(0); // Assent's request is invisible here
  });
});

describe('POST /bookings — window + capacity gates (Phase 7 D9/D11/D12)', () => {
  it('refuses a date the window has already closed (422 WINDOW_CLOSED)', async () => {
    const yesterdayish = new Date();
    yesterdayish.setUTCDate(yesterdayish.getUTCDate() + 1);
    const res = await book(ASSENT_USERS[0], yesterdayish.toISOString().slice(0, 10));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('WINDOW_CLOSED');
  });

  it('refuses a date beyond the horizon (422 WINDOW_CLOSED)', async () => {
    const far = new Date();
    far.setUTCDate(far.getUTCDate() + 90);
    // Must be a weekday, or the D7 check fires first and we would not be testing the horizon at all.
    while (far.getUTCDay() === 0 || far.getUTCDay() === 6) far.setUTCDate(far.getUTCDate() + 1);
    const res = await book(ASSENT_USERS[0], far.toISOString().slice(0, 10));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('WINDOW_CLOSED');
    expect(res.body.error.message).toMatch(/beyond the \d+-week booking window/);
  });

  it('refuses a weekend inside the window (D7)', async () => {
    const weekend = requestableDates(new Date(), DEFAULT_WINDOW_CONFIG)[0];
    const sat = new Date(`${weekend}T00:00:00.000Z`);
    while (sat.getUTCDay() !== 6) sat.setUTCDate(sat.getUTCDate() + 1);
    const res = await book(ASSENT_USERS[0], sat.toISOString().slice(0, 10));
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/weekday/i);
  });

  it('refuses the last request when the date is full, and never rejects at run time (D12/D13)', async () => {
    const sa = await login('superadmin@redbricks.example');
    const assentId = await companyIdOf(ASSENT_USERS[0]);
    // Squeeze capacity to 2 so three eligible users cannot all fit.
    await blockQuotaDownTo(sa, assentId, DATE, 2);

    expect((await book(ASSENT_USERS[0])).status).toBe(201);
    expect((await book(ASSENT_USERS[1])).status).toBe(201);

    // The third request is refused UP FRONT rather than being taken and rejected later.
    const third = await book(ASSENT_USERS[2]);
    expect(third.status).toBe(409);
    expect(third.body.error.code).toBe('CAPACITY_FULL');

    // The grid agrees, and says why.
    const grid = await request(app).get(`${API}/availability`).set(bearer(await login(ASSENT_USERS[2])));
    const day = grid.body.data.days.find((d: { date: string }) => d.date === DATE);
    expect(day.available).toBe(0);
    expect(day.requestable).toBe(false);
    expect(day.reason).toBe('FULL');

    // …and the run therefore allocates everyone who asked, with nobody waitlisted or rejected.
    const run = await request(app)
      .post(`${API}/allocation/primary/run`)
      .set(bearer(sa))
      .send({ bookingDate: DATE })
      .expect(200);
    expect(run.body.data.allocatedCount).toBe(2);
    expect(run.body.data.waitlistedCount).toBe(0);
    expect(await prisma.bookingRequest.count({ where: { bookingDate: dateUtc, status: 'REJECTED' } })).toBe(0);
  });

  it('refuses a duplicate request for the same date (409 CONFLICT, not CAPACITY_FULL)', async () => {
    await bookOk(ASSENT_USERS[0]);
    const again = await book(ASSENT_USERS[0]);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('CONFLICT');
  });

  it('closes a date for requests once its allocation has run', async () => {
    const sa = await login('superadmin@redbricks.example');
    await bookOk(ASSENT_USERS[0]);
    await request(app).post(`${API}/allocation/primary/run`).set(bearer(sa)).send({ bookingDate: DATE }).expect(200);

    const res = await book(ASSENT_USERS[1]);
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/already run|no longer open/i);

    const grid = await request(app).get(`${API}/availability`).set(bearer(await login(ASSENT_USERS[1])));
    const day = grid.body.data.days.find((d: { date: string }) => d.date === DATE);
    expect(day.requestable).toBe(false);
    expect(day.reason).toBe('TOO_SOON');
  });
});

describe('weekly allocation batch (Phase 7 D10/D11)', () => {
  it('owns a band starting at the first requestable date and decides every date at least the lead time ahead', async () => {
    const sa = await login('superadmin@redbricks.example');
    const res = await request(app).get(`${API}/allocation/weekly`).set(bearer(sa)).expect(200);
    const { window: win, band, dates } = res.body.data;

    // The band opens exactly where the request window opens — the batch decides what is open now.
    expect(band.from).toBe(win.earliestDate);
    expect(band.dates.length).toBeGreaterThan(0);
    expect(dates).toHaveLength(band.dates.length);

    const runDate = new Date(win.nextRunAt);
    const runDay = new Date(Date.UTC(runDate.getUTCFullYear(), runDate.getUTCMonth(), runDate.getUTCDate()));
    for (const d of band.dates) {
      const lead = (new Date(`${d}T00:00:00.000Z`).getTime() - runDay.getTime()) / (24 * 3600 * 1000);
      expect(lead).toBeGreaterThanOrEqual(win.approvalLeadDays);
    }
  });

  it('allocates the whole band in one call and is idempotent on re-run', async () => {
    const sa = await login('superadmin@redbricks.example');
    await bookOk(ASSENT_USERS[0]);
    await bookOk(ASSENT_USERS[1]);

    const first = await request(app).post(`${API}/allocation/weekly/run`).set(bearer(sa)).expect(200);
    expect(first.body.data.totalAllocated).toBe(2);
    expect(first.body.data.totalWaitlisted).toBe(0);
    expect(first.body.data.dates.every((d: { status: string }) => d.status === 'COMPLETED')).toBe(true);
    expect(first.body.data.dates.some((d: { alreadyDecided: boolean }) => d.alreadyDecided)).toBe(false);

    const allocationsAfterFirst = await prisma.parkingAllocation.count({ where: { bookingDate: dateUtc } });
    expect(allocationsAfterFirst).toBe(2);

    // Re-running must not allocate anything twice.
    const second = await request(app).post(`${API}/allocation/weekly/run`).set(bearer(sa)).expect(200);
    expect(second.body.data.dates.every((d: { alreadyDecided: boolean }) => d.alreadyDecided)).toBe(true);
    expect(await prisma.parkingAllocation.count({ where: { bookingDate: dateUtc } })).toBe(2);
  });

  it('is SUPER_ADMIN only', async () => {
    const user = await login(ASSENT_USERS[0]);
    await request(app).post(`${API}/allocation/weekly/run`).set(bearer(user)).expect(403);
    await request(app).get(`${API}/allocation/weekly`).set(bearer(user)).expect(403);
  });
});

describe('security gate (Phase 7 §5)', () => {
  const GUARD = 'security@redbricks.example';
  const KNOWN_PLATE = 'MH 12 AB 1234'; // seeded to Aditi Rao
  const UNKNOWN_PLATE = 'KA 05 ZZ 9999';

  it('resolves the driver from a car number, however it is spaced', async () => {
    const guard = await login(GUARD);
    for (const typed of ['MH12AB1234', 'mh-12-ab-1234', ' MH 12 ab.1234 ']) {
      const res = await request(app)
        .get(`${API}/vehicles/lookup`)
        .query({ number: typed })
        .set(bearer(guard))
        .expect(200);
      expect(res.body.data.vehicleNumber).toBe('MH12AB1234');
      expect(res.body.data.known).toBe(true);
      expect(res.body.data.vehicle.ownerName).toBe('Aditi Rao');
    }
  });

  it('records an entry for a car with no booking and flags it for the company admin (D16)', async () => {
    const guard = await login(GUARD);
    const res = await request(app)
      .post(`${API}/gate/check-in`)
      .set(bearer(guard))
      .send({ vehicleNumber: KNOWN_PLATE })
      .expect(201);
    expect(res.body.data.hadBooking).toBe(false);
    expect(res.body.data.status).toBe('CHECKED_IN');

    // The company admin sees it as an entry to follow up.
    const ca = await login('admin@assent.example');
    const feed = await request(app).get(`${API}/gate/unbooked`).set(bearer(ca)).expect(200);
    expect(feed.body.data).toHaveLength(1);
    expect(feed.body.data[0].vehicleNumber).toBe('MH12AB1234');
    expect(feed.body.data[0].hadBooking).toBe(false);
  });

  it('records an unregistered plate rather than refusing it, and keeps it out of any tenant feed', async () => {
    const guard = await login(GUARD);
    const res = await request(app)
      .post(`${API}/gate/check-in`)
      .set(bearer(guard))
      .send({ vehicleNumber: UNKNOWN_PLATE })
      .expect(201);
    expect(res.body.data.ownerName).toBeNull();
    expect(res.body.data.companyId).toBeNull();

    // No company owns it, so a company admin must not see it; the super admin does.
    const ca = await login('admin@assent.example');
    const caFeed = await request(app).get(`${API}/gate/unbooked`).set(bearer(ca)).expect(200);
    expect(caFeed.body.data).toHaveLength(0);

    const sa = await login('superadmin@redbricks.example');
    const saFeed = await request(app).get(`${API}/gate/unbooked`).set(bearer(sa)).expect(200);
    expect(saFeed.body.data.map((e: { vehicleNumber: string }) => e.vehicleNumber)).toContain('KA05ZZ9999');
  });

  it('refuses a double check-in but allows a fresh visit after checking out', async () => {
    const guard = await login(GUARD);
    await request(app).post(`${API}/gate/check-in`).set(bearer(guard)).send({ vehicleNumber: KNOWN_PLATE }).expect(201);

    const dupe = await request(app).post(`${API}/gate/check-in`).set(bearer(guard)).send({ vehicleNumber: KNOWN_PLATE });
    expect(dupe.status).toBe(409);

    const out = await request(app)
      .post(`${API}/gate/check-out`)
      .set(bearer(guard))
      .send({ vehicleNumber: KNOWN_PLATE })
      .expect(200);
    expect(out.body.data.status).toBe('CHECKED_OUT');
    expect(out.body.data.checkOutAt).toBeTruthy();

    // Same car, same day, second visit — allowed, because the first one is closed.
    await request(app).post(`${API}/gate/check-in`).set(bearer(guard)).send({ vehicleNumber: KNOWN_PLATE }).expect(201);
  });

  it('404s a check-out for a car that is not inside', async () => {
    const guard = await login(GUARD);
    const res = await request(app).post(`${API}/gate/check-out`).set(bearer(guard)).send({ vehicleNumber: KNOWN_PLATE });
    expect(res.status).toBe(404);
  });

  it('links the visit to the booking when the driver has one', async () => {
    // Book today so the gate has something to match. Today is outside the request window, so create
    // the row directly — this test is about the gate's matching, not the booking rules.
    const aditi = await prisma.user.findFirstOrThrow({ where: { email: ASSENT_USERS[0] } });
    const today = new Date();
    const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const istToday = new Date(todayUtc);
    await prisma.bookingRequest.create({
      data: {
        bookingDate: istToday,
        userId: aditi.id,
        companyId: aditi.companyId,
        bookingType: 'PRIMARY',
        status: 'ALLOCATED',
        userAddress: aditi.address,
        pinCode: aditi.pinCode,
        carpoolMemberCount: 0,
      },
    });

    const guard = await login(GUARD);
    const res = await request(app)
      .post(`${API}/gate/check-in`)
      .set(bearer(guard))
      .send({ vehicleNumber: KNOWN_PLATE })
      .expect(201);
    // Matched on the registered owner, so the guard did not have to know who was driving.
    expect(res.body.data.hadBooking).toBe(true);
    expect(res.body.data.bookingRequestId).toBeTruthy();
  });

  it('keeps the gate off-limits to ordinary users, and the unbooked feed off-limits to security', async () => {
    const user = await login(ASSENT_USERS[0]);
    await request(app).post(`${API}/gate/check-in`).set(bearer(user)).send({ vehicleNumber: KNOWN_PLATE }).expect(403);
    await request(app).get(`${API}/vehicles/lookup`).query({ number: KNOWN_PLATE }).set(bearer(user)).expect(403);

    const guard = await login(GUARD);
    await request(app).get(`${API}/gate/unbooked`).set(bearer(guard)).expect(403);
  });

  it('does not let a gate operator reach the booking endpoints', async () => {
    const guard = await login(GUARD);
    // A guard has no parking of their own to manage (D15).
    await request(app)
      .post(`${API}/bookings`)
      .set(bearer(guard))
      .send({ bookingDate: DATE, vehicleType: 'CAR', carpoolPeople: 1 })
      .expect(403);
  });
});
