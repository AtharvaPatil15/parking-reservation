import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { API, bearer, login, resetTransactional, futureBookableDate } from './integration/helpers';

/**
 * Edit booking (PATCH /bookings/{id}) + company quota-summary (GET /companies/quota-summary).
 * Uses the same window as the hero harness (DATE is a bookable weekday within the primary window).
 */

// Computed forward so the primary window is always open; seeded Assent quota (8) applies from today.
const DATE = futureBookableDate();

beforeEach(async () => {
  await resetTransactional();
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function createBooking(token: string) {
  const res = await request(app)
    .post(`${API}/bookings`)
    .set(bearer(token))
    .send({ bookingDate: DATE, vehicleType: 'CAR', carpoolPeople: 1 });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

describe('PATCH /bookings/:id — edit before cutoff', () => {
  it('edits an own, pending booking (vehicle + headcount + special requirement)', async () => {
    const aditi = await login('aditi@assent.example');
    const id = await createBooking(aditi);

    const edit = await request(app)
      .patch(`${API}/bookings/${id}`)
      .set(bearer(aditi))
      .send({ carpoolPeople: 3, vehicleType: 'CAR', vehicleNumber: 'KA-05-0001', specialRequirement: 'Near lift' });
    expect(edit.status).toBe(200);
    expect(edit.body.data.carpoolMemberCount).toBe(2); // people 3 → driver + 2
    expect(edit.body.data.vehicleType).toBe('CAR');
    expect(edit.body.data.vehicleNumber).toBe('KA-05-0001');
    expect(edit.body.data.specialRequirement).toBe('Near lift');

    // Persisted — a subsequent GET reflects the edit.
    const detail = await request(app).get(`${API}/bookings/${id}`).set(bearer(aditi));
    expect(detail.body.data.carpoolMemberCount).toBe(2);
    expect(detail.body.data.vehicleType).toBe('CAR');
  });

  it('rejects non-car vehicle types on edit', async () => {
    const aditi = await login('aditi@assent.example');
    const id = await createBooking(aditi);

    const edit = await request(app)
      .patch(`${API}/bookings/${id}`)
      .set(bearer(aditi))
      .send({ vehicleType: 'EV_CAR' });

    expect(edit.status).toBe(400);
    expect(edit.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'vehicleType',
          message: 'Only normal car bookings are supported right now',
        }),
      ]),
    );
  });

  it('hides another user’s booking — edit returns 404', async () => {
    const aditi = await login('aditi@assent.example');
    const id = await createBooking(aditi);

    const rahul = await login('rahul@assent.example');
    await request(app)
      .patch(`${API}/bookings/${id}`)
      .set(bearer(rahul))
      .send({ carpoolPeople: 2 })
      .expect(404);
  });

  it('rejects an empty edit (400) — at least one field required', async () => {
    const aditi = await login('aditi@assent.example');
    const id = await createBooking(aditi);
    await request(app).patch(`${API}/bookings/${id}`).set(bearer(aditi)).send({}).expect(400);
  });
});

describe('GET /companies/quota-summary — assigned per company (SA)', () => {
  it('returns the effective assigned quota for the date', async () => {
    const sa = await login('superadmin@redbricks.example');
    const res = await request(app).get(`${API}/companies/quota-summary`).query({ date: DATE }).set(bearer(sa));
    expect(res.status).toBe(200);

    const assent = await prisma.company.findFirstOrThrow({ where: { code: 'ASSENT' } });
    const entry = (res.body.data as Array<{ companyId: string; assignedSlots: number }>).find(
      (e) => e.companyId === assent.id,
    );
    expect(entry?.assignedSlots).toBe(8); // seeded Assent quota effective for DATE
  });

  it('is Super-Admin only — a Company Admin gets 403', async () => {
    const ca = await login('admin@assent.example');
    await request(app).get(`${API}/companies/quota-summary`).query({ date: DATE }).set(bearer(ca)).expect(403);
  });
});
describe('GET /me/bookings — own history', () => {
  it('returns the current user’s bookings', async () => {
    const aditi = await login('aditi@assent.example');
    const id = await createBooking(aditi);
    const res = await request(app).get(`${API}/me/bookings`).set(bearer(aditi));
    expect(res.status).toBe(200);
    expect((res.body.data as Array<{ id: string }>).map((b) => b.id)).toContain(id);
  });
});

describe('POST /bookings — admins can also book', () => {
  it('lets a COMPANY_ADMIN create a booking that shows in their own history', async () => {
    const ca = await login('admin@assent.example');
    const res = await request(app)
      .post(`${API}/bookings`)
      .set(bearer(ca))
      .send({ bookingDate: DATE, carpoolPeople: 1 });
    expect(res.status).toBe(201);

    const hist = await request(app).get(`${API}/me/bookings`).set(bearer(ca));
    expect(hist.status).toBe(200);
    expect((hist.body.data as Array<{ id: string }>).map((b) => b.id)).toContain(res.body.data.id);
  });
});
