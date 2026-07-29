import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { API, bearer, login, resetTransactional } from './integration/helpers';

/**
 * P4-19 — backend integration tests (Supertest + throwaway Postgres, provisioned by
 * tests/integration/globalSetup.ts). Covers the DEMO hero path, no-double-assignment under
 * concurrency, and tenant isolation on booking reads.
 */

const DATE = '2026-07-31'; // Friday; seeded quota (8) is effective for it.
const dateUtc = new Date(`${DATE}T00:00:00.000Z`);

beforeEach(async () => {
  await resetTransactional();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('hero path: login → book → run → status → breakdown', () => {
  it('allocates a submitted booking and explains the outcome', async () => {
    // 1. USER books (Aditi, 12.4 km, solo → people 1).
    const userToken = await login('aditi@assent.example');
    const create = await request(app)
      .post(`${API}/bookings`)
      .set(bearer(userToken))
      .send({ bookingDate: DATE, vehicleType: 'CAR', carpoolPeople: 1 });
    expect(create.status).toBe(201);
    expect(create.body.data.status).toBe('SUBMITTED');
    expect(create.body.data.travelDistanceKm).toBe(12.4); // snapshot (F6)
    const bookingId = create.body.data.id as string;

    // 2. SUPER_ADMIN runs primary allocation.
    const saToken = await login('superadmin@redbricks.example');
    const run = await request(app)
      .post(`${API}/allocation/primary/run`)
      .set(bearer(saToken))
      .send({ bookingDate: DATE });
    expect(run.status).toBe(200);
    expect(run.body.data.status).toBe('COMPLETED');
    expect(run.body.data.totalRequests).toBe(1);
    expect(run.body.data.allocatedCount).toBe(1);
    expect(run.body.data.waitlistedCount).toBe(0);
    const runId = run.body.data.id as string;

    // 3. Run summary via GET.
    const summary = await request(app).get(`${API}/allocation/runs/${runId}`).set(bearer(saToken));
    expect(summary.status).toBe(200);
    expect(summary.body.data.allocatedCount).toBe(1);

    // 4. Breakdown explains the score (decisions §3: 12.4/40*100 = 31 → 0.6*31 = 18.6).
    const bd = await request(app).get(`${API}/allocation/runs/${runId}/breakdown`).set(bearer(saToken));
    expect(bd.status).toBe(200);
    const rows = bd.body.data.results;
    expect(rows).toHaveLength(1);
    expect(rows[0].user).toBe('Aditi Rao');
    expect(rows[0].rank).toBe(1);
    expect(rows[0].distanceScore).toBe(31);
    expect(rows[0].carpoolScore).toBe(0);
    expect(rows[0].finalScore).toBe(18.6);
    expect(rows[0].outcome).toBe('ALLOCATED');
    expect(rows[0].slotNumber).toBeTruthy();

    // 5. The booking now reflects the allocation + persisted breakdown.
    const detail = await request(app).get(`${API}/bookings/${bookingId}`).set(bearer(userToken));
    expect(detail.body.data.status).toBe('ALLOCATED');
    expect(detail.body.data.allocatedSlotNumber).toBeTruthy();
    expect(detail.body.data.scoreBreakdown.finalScore).toBe(18.6);
  });

  it('waitlists beyond available quota (block reduces quota to 1)', async () => {
    const saToken = await login('superadmin@redbricks.example');
    const assentId = await companyIdOf('aditi@assent.example');

    // Two bookings; block 7 of 8 → available quota 1 → top-scorer allocated, other waitlisted.
    await book('aditi@assent.example'); // 12.4 → final 18.6
    await book('sara@assent.example'); //  38.1 → final 57.15 (wins)
    await request(app)
      .post(`${API}/companies/${assentId}/blocks`)
      .set(bearer(saToken))
      .send({ blockedCount: 7, startDate: DATE, endDate: DATE, reason: 'OTHER' })
      .expect(201);

    const run = await request(app).post(`${API}/allocation/primary/run`).set(bearer(saToken)).send({ bookingDate: DATE });
    expect(run.body.data.allocatedCount).toBe(1);
    expect(run.body.data.waitlistedCount).toBe(1);

    const bd = await request(app).get(`${API}/allocation/runs/${run.body.data.id}/breakdown`).set(bearer(saToken));
    const rows = bd.body.data.results as Array<{ user: string; outcome: string; rank: number }>;
    expect(rows[0].user).toBe('Sara Khan'); // higher finalScore ranks first
    expect(rows[0].outcome).toBe('ALLOCATED');
    expect(rows[1].user).toBe('Aditi Rao');
    expect(rows[1].outcome).toBe('WAITLISTED');
  });
});

describe('concurrency: the unique (slotId, bookingDate) constraint prevents double-assignment', () => {
  it('two concurrent runs yield exactly one allocation per booking and per slot', async () => {
    await book('aditi@assent.example');
    await book('rahul@assent.example');
    const saToken = await login('superadmin@redbricks.example');

    // Fire two runs at once. One may lose the race (its txn rolls back); DB integrity must hold.
    await Promise.allSettled([
      request(app).post(`${API}/allocation/primary/run`).set(bearer(saToken)).send({ bookingDate: DATE }),
      request(app).post(`${API}/allocation/primary/run`).set(bearer(saToken)).send({ bookingDate: DATE }),
    ]);

    const allocations = await prisma.parkingAllocation.findMany({ where: { bookingDate: dateUtc } });
    expect(allocations).toHaveLength(2); // the 2 bookings, never doubled
    expect(new Set(allocations.map((a) => a.slotId)).size).toBe(2); // 2 distinct slots
    expect(new Set(allocations.map((a) => a.bookingRequestId)).size).toBe(2);
  });

  it('rejects a second allocation for the same slot+date (slot-uniqueness backstop)', async () => {
    // Two bookings, quota blocked to 1 → one ALLOCATED, one WAITLISTED (its bookingRequestId is free).
    await book('aditi@assent.example'); // 12.4
    await book('rahul@assent.example'); // 24.8 → wins the single slot
    const saToken = await login('superadmin@redbricks.example');
    const assentId = await companyIdOf('aditi@assent.example');
    await request(app)
      .post(`${API}/companies/${assentId}/blocks`)
      .set(bearer(saToken))
      .send({ blockedCount: 7, startDate: DATE, endDate: DATE, reason: 'OTHER' })
      .expect(201);
    await request(app).post(`${API}/allocation/primary/run`).set(bearer(saToken)).send({ bookingDate: DATE }).expect(200);

    const allocated = await prisma.parkingAllocation.findFirstOrThrow({ where: { bookingDate: dateUtc } });
    const waitlisted = await prisma.bookingRequest.findFirstOrThrow({ where: { bookingDate: dateUtc, status: 'WAITLISTED' } });
    // A *different* (unallocated) booking taking the already-assigned slot must violate ONLY the
    // (slotId, bookingDate) unique — proving the anti-double-assignment backstop specifically.
    await expect(
      prisma.parkingAllocation.create({
        data: {
          bookingRequestId: waitlisted.id,
          slotId: allocated.slotId,
          bookingDate: dateUtc,
          companyId: waitlisted.companyId,
          allocationType: 'PRIMARY',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('tenant isolation on GET /bookings/:id', () => {
  it('hides a booking from other tenants (404) but not from SUPER_ADMIN (200)', async () => {
    // Aditi's own booking.
    const aditiToken = await login('aditi@assent.example');
    const aditiBooking = (
      await request(app).post(`${API}/bookings`).set(bearer(aditiToken)).send({ bookingDate: DATE, carpoolPeople: 1 })
    ).body.data.id as string;

    // A booking owned by a user in a different company (created directly).
    const other = await prisma.company.upsert({
      where: { code: 'OTHERCO' },
      update: {},
      create: { code: 'OTHERCO', name: 'Other Co', status: 'ACTIVE' },
    });
    const otherUser = await prisma.user.upsert({
      where: { email: 'other@otherco.example' },
      update: {},
      create: {
        fullName: 'Other User',
        email: 'other@otherco.example',
        contactNumber: '+91-9000000009',
        address: 'Elsewhere',
        pinCode: '400001',
        passwordHash: 'placeholder-not-used',
        status: 'ACTIVE',
        emailVerified: true,
        companyId: other.id,
      },
    });
    const otherBooking = await prisma.bookingRequest.create({
      data: {
        bookingDate: dateUtc,
        userId: otherUser.id,
        companyId: other.id,
        bookingType: 'PRIMARY',
        status: 'SUBMITTED',
        userAddress: otherUser.address,
        pinCode: otherUser.pinCode,
      },
    });

    // USER cannot read another user's booking (even same company would 404; here cross-company).
    await request(app).get(`${API}/bookings/${otherBooking.id}`).set(bearer(aditiToken)).expect(404);

    // COMPANY_ADMIN cannot read another company's booking.
    const caToken = await login('admin@assent.example');
    await request(app).get(`${API}/bookings/${otherBooking.id}`).set(bearer(caToken)).expect(404);

    // A same-company USER cannot read Aditi's booking either (user-level isolation).
    const rahulToken = await login('rahul@assent.example');
    await request(app).get(`${API}/bookings/${aditiBooking}`).set(bearer(rahulToken)).expect(404);

    // SUPER_ADMIN can read any booking.
    const saToken = await login('superadmin@redbricks.example');
    await request(app).get(`${API}/bookings/${otherBooking.id}`).set(bearer(saToken)).expect(200);
  });
});

// --- helpers scoped to this file -------------------------------------------------------------

async function book(email: string): Promise<string> {
  const token = await login(email);
  const res = await request(app).post(`${API}/bookings`).set(bearer(token)).send({ bookingDate: DATE, carpoolPeople: 1 });
  expect(res.status).toBe(201);
  return res.body.data.id;
}

async function companyIdOf(email: string): Promise<string> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email }, select: { companyId: true } });
  return u.companyId;
}
