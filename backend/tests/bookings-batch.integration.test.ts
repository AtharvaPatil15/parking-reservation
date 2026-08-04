import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import {
  API,
  bearer,
  login,
  futureBookableDate,
  blockQuotaDownTo,
  resetTransactional,
} from './integration/helpers';
import { MAX_BATCH_DATES } from '../src/modules/bookings/bookings.schema';

/**
 * POST /bookings/batch — multi-date booking.
 *
 * The contract that matters here is **partial success**: one date failing must never discard the
 * others, and the response must say per date what happened. That is the whole reason this is a 200
 * with a report rather than a 201-or-nothing.
 */

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetTransactional();
});

const assentId = async () => (await prisma.company.findFirstOrThrow({ where: { code: 'ASSENT' } })).id;

interface BatchResult {
  bookingDate: string;
  outcome: 'CREATED' | 'FAILED';
  booking?: { id: string; bookingDate: string; status: string };
  code?: string;
  message?: string;
}
interface BatchData {
  requested: number;
  createdCount: number;
  failedCount: number;
  results: BatchResult[];
}

const batch = async (token: string, body: Record<string, unknown>) =>
  request(app).post(`${API}/bookings/batch`).set(bearer(token)).send(body);

const byDate = (data: BatchData, date: string) =>
  data.results.find((r) => r.bookingDate === date) as BatchResult;

describe('POST /bookings/batch', () => {
  it('books every requested date and persists one PRIMARY request each', async () => {
    const token = await login('aditi@assent.example');
    const dates = [futureBookableDate(0), futureBookableDate(1), futureBookableDate(2)];

    const res = await batch(token, { bookingDates: dates, carpoolPeople: 1 });
    expect(res.status).toBe(200);
    const data = res.body.data as BatchData;
    expect(data).toMatchObject({ requested: 3, createdCount: 3, failedCount: 0 });
    expect(data.results.map((r) => r.bookingDate)).toEqual(dates);
    expect(data.results.every((r) => r.outcome === 'CREATED')).toBe(true);
    // Each result carries its own booking, dated to its own day — not the first one repeated.
    for (const r of data.results) expect(r.booking?.bookingDate).toBe(r.bookingDate);

    const rows = await prisma.bookingRequest.findMany({
      where: { bookingType: 'PRIMARY' },
      orderBy: { bookingDate: 'asc' },
    });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.bookingDate.toISOString().slice(0, 10))).toEqual(dates);
  });

  it('applies the shared trip details to every date', async () => {
    const token = await login('aditi@assent.example');
    const dates = [futureBookableDate(0), futureBookableDate(1)];

    const res = await batch(token, {
      bookingDates: dates,
      carpoolPeople: 2,
      vehicleNumber: 'MH12AB1234',
      specialRequirement: 'Near the lift',
      carpoolMembers: [{ name: 'Rahul Mehta', employeeEmail: 'rahul@assent.example' }],
    });
    expect(res.status).toBe(200);

    const rows = await prisma.bookingRequest.findMany({ include: { carpoolMembers: true } });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.vehicleNumber).toBe('MH12AB1234');
      expect(row.specialRequirement).toBe('Near the lift');
      expect(row.carpoolMemberCount).toBe(1);
      // The member is duplicated per date, and scored on each (same-company employee, F4).
      expect(row.carpoolMembers).toHaveLength(1);
      expect(row.carpoolMembers[0]?.isScored).toBe(true);
    }
  });

  // Was: "keeps the dates that fit when one is full". Phase 8 (D18) removed capacity from the submit
  // path, so a contested date is not a failure any more — it is just a longer queue. The partial-result
  // path this test used to exercise is now covered by the CONFLICT test below, which is a refusal that
  // still exists.
  it('queues a contested date alongside quiet ones, with no per-date failure (D18)', async () => {
    const saToken = await login('superadmin@redbricks.example');
    const companyId = await assentId();
    const [contested, open1, open2] = [futureBookableDate(0), futureBookableDate(1), futureBookableDate(2)];

    // One slot on `contested`, and someone has already asked for it.
    await blockQuotaDownTo(saToken, companyId, contested, 1);
    const rahul = await login('rahul@assent.example');
    const taken = await request(app)
      .post(`${API}/bookings`)
      .set(bearer(rahul))
      .send({ bookingDate: contested, carpoolPeople: 1 });
    expect(taken.status).toBe(201);

    const aditi = await login('aditi@assent.example');
    const res = await batch(aditi, { bookingDates: [contested, open1, open2], carpoolPeople: 1 });

    expect(res.status).toBe(200);
    const data = res.body.data as BatchData;
    expect(data).toMatchObject({ requested: 3, createdCount: 3, failedCount: 0 });
    for (const date of [contested, open1, open2]) {
      expect(byDate(data, date).outcome).toBe('CREATED');
    }

    // All three persisted, including the one with more demand than supply.
    const mine = await prisma.bookingRequest.findMany({
      where: { user: { email: 'aditi@assent.example' } },
      orderBy: { bookingDate: 'asc' },
    });
    expect(mine.map((r) => r.bookingDate.toISOString().slice(0, 10))).toEqual([contested, open1, open2]);
    expect(mine.every((r) => r.status === 'SUBMITTED')).toBe(true);

    // Two people now contest one slot — which the weekly run resolves by score, not by arrival order.
    expect(
      await prisma.bookingRequest.count({
        where: { bookingDate: new Date(`${contested}T00:00:00.000Z`), bookingType: 'PRIMARY' },
      }),
    ).toBe(2);
  });

  it('reports an already-requested date as CONFLICT without touching the rest', async () => {
    const token = await login('aditi@assent.example');
    const [already, fresh] = [futureBookableDate(0), futureBookableDate(1)];
    const first = await request(app)
      .post(`${API}/bookings`)
      .set(bearer(token))
      .send({ bookingDate: already, carpoolPeople: 1 });
    expect(first.status).toBe(201);

    const res = await batch(token, { bookingDates: [already, fresh], carpoolPeople: 1 });
    expect(res.status).toBe(200);
    const data = res.body.data as BatchData;
    expect(data).toMatchObject({ createdCount: 1, failedCount: 1 });
    expect(byDate(data, already)).toMatchObject({ outcome: 'FAILED', code: 'CONFLICT' });
    expect(byDate(data, fresh).outcome).toBe('CREATED');
    // Still exactly one row for the duplicated date — no second request slipped through.
    expect(
      await prisma.bookingRequest.count({
        where: { bookingDate: new Date(`${already}T00:00:00.000Z`) },
      }),
    ).toBe(1);
  });

  it('flags a date outside the window per-date, not as a request-level failure', async () => {
    const token = await login('aditi@assent.example');
    const open = futureBookableDate(0);

    const res = await batch(token, {
      // Far past the 2-week horizon — the single-date endpoint 422s on this.
      bookingDates: [open, '2099-01-05'],
      carpoolPeople: 1,
    });
    expect(res.status).toBe(200);
    const data = res.body.data as BatchData;
    expect(byDate(data, open).outcome).toBe('CREATED');
    expect(byDate(data, '2099-01-05')).toMatchObject({ outcome: 'FAILED', code: 'WINDOW_CLOSED' });
  });

  it('returns 200 with every result FAILED rather than an error status', async () => {
    const token = await login('aditi@assent.example');
    // Two dates that are both beyond the window: nothing can be booked, but the request was valid.
    const res = await batch(token, { bookingDates: ['2099-01-05', '2099-01-06'], carpoolPeople: 1 });
    expect(res.status).toBe(200);
    const data = res.body.data as BatchData;
    expect(data).toMatchObject({ requested: 2, createdCount: 0, failedCount: 2 });
    expect(data.results.every((r) => r.outcome === 'FAILED')).toBe(true);
    expect(await prisma.bookingRequest.count()).toBe(0);
  });

  it('collapses duplicate dates and sorts ascending', async () => {
    const token = await login('aditi@assent.example');
    const [a, b] = [futureBookableDate(0), futureBookableDate(1)];

    // Sent out of order, with a repeat — a UI slip, not an error.
    const res = await batch(token, { bookingDates: [b, a, b], carpoolPeople: 1 });
    expect(res.status).toBe(200);
    const data = res.body.data as BatchData;
    expect(data).toMatchObject({ requested: 2, createdCount: 2 });
    expect(data.results.map((r) => r.bookingDate)).toEqual([a, b]);
  });

  describe('request-level validation (400 — nothing is booked)', () => {
    it('rejects an empty date list', async () => {
      const token = await login('aditi@assent.example');
      const res = await batch(token, { bookingDates: [], carpoolPeople: 1 });
      expect(res.status).toBe(400);
      expect(await prisma.bookingRequest.count()).toBe(0);
    });

    it(`rejects more than ${MAX_BATCH_DATES} distinct dates`, async () => {
      const token = await login('aditi@assent.example');
      // Distinct, well-formed, and one over the cap.
      const dates = Array.from({ length: MAX_BATCH_DATES + 1 }, (_, i) => {
        const d = new Date(Date.UTC(2099, 0, 5 + i));
        return d.toISOString().slice(0, 10);
      });
      const res = await batch(token, { bookingDates: dates, carpoolPeople: 1 });
      expect(res.status).toBe(400);
      expect(await prisma.bookingRequest.count()).toBe(0);
    });

    it('rejects a malformed date before booking anything', async () => {
      const token = await login('aditi@assent.example');
      const res = await batch(token, {
        bookingDates: [futureBookableDate(0), 'not-a-date'],
        carpoolPeople: 1,
      });
      expect(res.status).toBe(400);
      // The valid date must NOT have been booked — a bad payload never books a partial set.
      expect(await prisma.bookingRequest.count()).toBe(0);
    });

    it('rejects a carpool over the cap before booking anything', async () => {
      const token = await login('aditi@assent.example');
      const res = await batch(token, {
        bookingDates: [futureBookableDate(0), futureBookableDate(1)],
        carpoolPeople: 99,
      });
      expect(res.status).toBe(400);
      expect(await prisma.bookingRequest.count()).toBe(0);
    });
  });

  it('requires authentication', async () => {
    const res = await request(app)
      .post(`${API}/bookings/batch`)
      .send({ bookingDates: [futureBookableDate(0)], carpoolPeople: 1 });
    expect(res.status).toBe(401);
  });
});
