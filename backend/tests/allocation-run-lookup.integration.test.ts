import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { API, bearer, login, resetTransactional, futureBookableDate } from './integration/helpers';

/**
 * GET /allocation/runs?date=&type= — lets the UI tell whether allocation has already been done for a
 * date (so it can disable a redundant re-run and show stored results) without triggering a run.
 * Returns the run summary, or null when none has been triggered.
 */
const DATE = futureBookableDate();

beforeEach(async () => {
  await resetTransactional();
});
afterAll(async () => {
  await resetTransactional();
  await prisma.$disconnect();
});

describe('GET /allocation/runs — existing-run lookup', () => {
  it('returns null when no run has been triggered for the date', async () => {
    const sa = await login('superadmin');
    const res = await request(app).get(`${API}/allocation/runs`).query({ date: DATE, type: 'PRIMARY' }).set(bearer(sa));
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('returns the COMPLETED run once primary allocation has run', async () => {
    const userToken = await login('aditi');
    await request(app)
      .post(`${API}/bookings`)
      .set(bearer(userToken))
      .send({ bookingDate: DATE, vehicleType: 'CAR', carpoolPeople: 1 })
      .expect(201);

    const sa = await login('superadmin');
    await request(app).post(`${API}/allocation/primary/run`).set(bearer(sa)).send({ bookingDate: DATE }).expect(200);

    const res = await request(app).get(`${API}/allocation/runs`).query({ date: DATE, type: 'PRIMARY' }).set(bearer(sa));
    expect(res.status).toBe(200);
    expect(res.body.data).not.toBeNull();
    expect(res.body.data.runType).toBe('PRIMARY');
    expect(res.body.data.status).toBe('COMPLETED');
    expect(res.body.data.bookingDate).toBe(DATE);

    // A different run type for the same date is independent — still null until it's run.
    const cp = await request(app).get(`${API}/allocation/runs`).query({ date: DATE, type: 'COMMON_POOL' }).set(bearer(sa));
    expect(cp.body.data).toBeNull();
  });

  it('rejects a missing type with 400', async () => {
    const sa = await login('superadmin');
    const res = await request(app).get(`${API}/allocation/runs`).query({ date: DATE }).set(bearer(sa));
    expect(res.status).toBe(400);
  });

  it('forbids a non-super-admin (403)', async () => {
    const ca = await login('companyadmin');
    const res = await request(app).get(`${API}/allocation/runs`).query({ date: DATE, type: 'PRIMARY' }).set(bearer(ca));
    expect(res.status).toBe(403);
  });
});
