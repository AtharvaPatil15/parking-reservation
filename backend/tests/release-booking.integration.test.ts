import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { runPrimaryAllocation } from '../src/modules/allocation/allocation.service';
import { invalidateConfig } from '../src/config/systemConfig';
import { API, bearer, login, resetTransactional, futureBookableDate } from './integration/helpers';

/**
 * Release + reallocation cascade (POST /bookings/{id}/release, F3).
 *
 * The rule under test: a freed slot goes to the releasing user's OWN company waitlist first
 * (right of first refusal, regardless of score); only when that tier is empty does it cross the
 * company boundary to the highest-ranked waitlisted request anywhere.
 *
 * Bookings are seeded directly through Prisma rather than the API so the tests don't depend on the
 * primary cutoff window still being open for the chosen date. The date itself is computed forward
 * from today (a bookable weekday) so release's "date has passed" guard never trips.
 */

const OTHER_COMPANY_CODE = 'OTHERCO';
const OTHER_USER_EMAIL = 'other@otherco.example';

// Resolved in beforeAll — keyed on the unique code/email rather than a fixed id so a leftover row
// from an interrupted run is reused instead of colliding.
let otherCompanyId: string;
let otherUserId: string;

const DATE = futureBookableDate();
const bookingDate = new Date(`${DATE}T00:00:00.000Z`);

let assentId: string;

/** Insert a SUBMITTED PRIMARY booking straight into the DB with a chosen distance (drives score). */
async function seedBooking(userId: string, companyId: string, distanceKm: number, people = 1) {
  return prisma.bookingRequest.create({
    data: {
      bookingDate,
      userId,
      companyId,
      bookingType: 'PRIMARY',
      status: 'SUBMITTED',
      userAddress: 'Test address',
      pinCode: '411057',
      travelDistanceKm: distanceKm,
      carpoolMemberCount: people - 1,
      submittedAt: new Date(),
    },
  });
}

async function seedCommonPoolWaitlist(userId: string, companyId: string, distanceKm: number, people = 1) {
  return prisma.bookingRequest.create({
    data: {
      bookingDate,
      userId,
      companyId,
      bookingType: 'COMMON_POOL',
      status: 'WAITLISTED',
      userAddress: 'Test address',
      pinCode: '411057',
      travelDistanceKm: distanceKm,
      carpoolMemberCount: people - 1,
      submittedAt: new Date(),
    },
  });
}

/** Cap Assent's effective quota for DATE by blocking the rest (SlotBlock is cleared between tests). */
async function capAssentQuotaTo(n: number) {
  const quota = await prisma.companySlotAllocation.findFirstOrThrow({ where: { companyId: assentId } });
  await prisma.slotBlock.create({
    data: {
      companyId: assentId,
      startDate: bookingDate,
      endDate: bookingDate,
      blockedCount: Math.max(0, quota.slotCount - n),
      reason: 'MAINTENANCE',
      createdById: (await prisma.user.findFirstOrThrow({ where: { email: 'superadmin@redbricks.example' } })).id,
    },
  });
}

const statusOf = async (id: string) =>
  (await prisma.bookingRequest.findUniqueOrThrow({ where: { id } })).status;
const slotIdOf = async (bookingRequestId: string) =>
  (await prisma.parkingAllocation.findUnique({ where: { bookingRequestId } }))?.slotId ?? null;
const allocationCountForUser = async (userId: string) =>
  prisma.parkingAllocation.count({ where: { bookingDate, bookingRequest: { userId } } });

beforeAll(async () => {
  assentId = (await prisma.company.findFirstOrThrow({ where: { code: 'ASSENT' } })).id;
  // A second tenant with one user, so the cross-company branch has somewhere to go. No login
  // needed — these tests only assert who the slot lands on.
  otherCompanyId = (
    await prisma.company.upsert({
      where: { code: OTHER_COMPANY_CODE },
      update: {},
      create: { code: OTHER_COMPANY_CODE, name: 'Other Co', status: 'ACTIVE' },
    })
  ).id;
  otherUserId = (
    await prisma.user.upsert({
      where: { email: OTHER_USER_EMAIL },
      update: { companyId: otherCompanyId },
      create: {
        email: OTHER_USER_EMAIL,
        fullName: 'Other Person',
        passwordHash: 'x', // never used — this user never logs in
        contactNumber: '9000000999',
        address: 'Far away',
        pinCode: '400001',
        distanceKm: 39,
        status: 'ACTIVE',
        companyId: otherCompanyId,
      },
    })
  ).id;
});

beforeEach(async () => {
  await resetTransactional();
});

afterAll(async () => {
  await resetTransactional();
  await prisma.user.deleteMany({ where: { email: OTHER_USER_EMAIL } });
  await prisma.company.deleteMany({ where: { code: OTHER_COMPANY_CODE } });
  await prisma.$disconnect();
});

describe('POST /bookings/:id/release — frees the slot', () => {
  it('releases an allocated booking and marks it RELEASED', async () => {
    const aditi = await login('aditi@assent.example');
    const me = await prisma.user.findFirstOrThrow({ where: { email: 'aditi@assent.example' } });
    const b = await seedBooking(me.id, assentId, 12);
    await runPrimaryAllocation(DATE);
    expect(await statusOf(b.id)).toBe('ALLOCATED');

    const res = await request(app).post(`${API}/bookings/${b.id}/release`).set(bearer(aditi));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('RELEASED');
    expect(res.body.data.allocatedSlotNumber).toBeNull();
    expect(await slotIdOf(b.id)).toBeNull();
  });

  it('rejects releasing a booking that is not allocated (409)', async () => {
    const aditi = await login('aditi@assent.example');
    const me = await prisma.user.findFirstOrThrow({ where: { email: 'aditi@assent.example' } });
    const b = await seedBooking(me.id, assentId, 12); // still SUBMITTED — no allocation run
    await request(app).post(`${API}/bookings/${b.id}/release`).set(bearer(aditi)).send({}).expect(409);
  });

  it('hides another user’s booking — release returns 404', async () => {
    const me = await prisma.user.findFirstOrThrow({ where: { email: 'aditi@assent.example' } });
    const b = await seedBooking(me.id, assentId, 12);
    await runPrimaryAllocation(DATE);

    const rahul = await login('rahul@assent.example');
    await request(app).post(`${API}/bookings/${b.id}/release`).set(bearer(rahul)).send({}).expect(404);
  });
});

describe('POST /bookings/:id/release — reallocation priority (F3)', () => {
  it('hands the slot to the own-company waitlist', async () => {
    await capAssentQuotaTo(1);
    const aditi = await prisma.user.findFirstOrThrow({ where: { email: 'aditi@assent.example' } });
    const rahul = await prisma.user.findFirstOrThrow({ where: { email: 'rahul@assent.example' } });

    const winner = await seedBooking(aditi.id, assentId, 30); // higher distance → allocated
    const waiting = await seedBooking(rahul.id, assentId, 10); // waitlisted
    await runPrimaryAllocation(DATE);
    expect(await statusOf(winner.id)).toBe('ALLOCATED');
    expect(await statusOf(waiting.id)).toBe('WAITLISTED');
    const freedSlot = await slotIdOf(winner.id);

    const token = await login('aditi@assent.example');
    await request(app).post(`${API}/bookings/${winner.id}/release`).set(bearer(token)).send({}).expect(200);

    expect(await statusOf(waiting.id)).toBe('ALLOCATED');
    expect(await slotIdOf(waiting.id)).toBe(freedSlot); // the same physical bay changed hands

    const admin = await login('superadmin@redbricks.example');
    const list = await request(app).get(`${API}/bookings`).query({ date: DATE }).set(bearer(admin)).expect(200);
    const row = list.body.data.find((b: { id: string }) => b.id === waiting.id);
    expect(row.bookingType).toBe('PRIMARY');
    expect(row.allocationSource).toBe('RELEASED_SLOT');
  });

  it('updates the promoted booking score breakdown to the release-time score', async () => {
    await capAssentQuotaTo(1);
    const aditi = await prisma.user.findFirstOrThrow({ where: { email: 'aditi@assent.example' } });
    const rahul = await prisma.user.findFirstOrThrow({ where: { email: 'rahul@assent.example' } });

    const holder = await seedBooking(aditi.id, assentId, 30);
    const waiting = await seedBooking(rahul.id, assentId, 10);
    await runPrimaryAllocation(DATE);
    expect(await statusOf(waiting.id)).toBe('WAITLISTED');

    const originalMaxDistance = await prisma.systemConfiguration.findUniqueOrThrow({
      where: { key: 'allocation.maxDistanceKm' },
    });
    try {
      await prisma.systemConfiguration.update({
        where: { key: 'allocation.maxDistanceKm' },
        data: { value: '20' },
      });
      invalidateConfig();

      const token = await login('aditi@assent.example');
      await request(app).post(`${API}/bookings/${holder.id}/release`).set(bearer(token)).send({}).expect(200);

      const admin = await login('superadmin@redbricks.example');
      const detail = await request(app).get(`${API}/bookings/${waiting.id}`).set(bearer(admin)).expect(200);
      expect(detail.body.data.allocationScore).toBe(30);
      expect(detail.body.data.scoreBreakdown.finalScore).toBe(30);
      expect(detail.body.data.scoreBreakdown.distanceScore).toBe(50);
    } finally {
      await prisma.systemConfiguration.update({
        where: { key: 'allocation.maxDistanceKm' },
        data: { value: originalMaxDistance.value },
      });
      invalidateConfig();
    }
  });

  it('prefers a lower-scoring OWN-company waitlister over a higher-scoring other company', async () => {
    await capAssentQuotaTo(1);
    const aditi = await prisma.user.findFirstOrThrow({ where: { email: 'aditi@assent.example' } });
    const rahul = await prisma.user.findFirstOrThrow({ where: { email: 'rahul@assent.example' } });

    const holder = await seedBooking(aditi.id, assentId, 30);
    const ownCompanyLowScore = await seedBooking(rahul.id, assentId, 5); // weak score, right company
    const otherCompanyHighScore = await seedBooking(otherUserId, otherCompanyId, 40); // strongest overall
    await runPrimaryAllocation(DATE);
    expect(await statusOf(ownCompanyLowScore.id)).toBe('WAITLISTED');
    expect(await statusOf(otherCompanyHighScore.id)).toBe('WAITLISTED'); // OtherCo has no quota

    const token = await login('aditi@assent.example');
    await request(app).post(`${API}/bookings/${holder.id}/release`).set(bearer(token)).send({}).expect(200);

    // Own-company first refusal wins despite the worse score.
    expect(await statusOf(ownCompanyLowScore.id)).toBe('ALLOCATED');
    expect(await statusOf(otherCompanyHighScore.id)).toBe('WAITLISTED');
  });

  it('does not let unscored declared carpool members inflate own-company release priority', async () => {
    await capAssentQuotaTo(1);
    const aditi = await prisma.user.findFirstOrThrow({ where: { email: 'aditi@assent.example' } });
    const rahul = await prisma.user.findFirstOrThrow({ where: { email: 'rahul@assent.example' } });
    const sara = await prisma.user.findFirstOrThrow({ where: { email: 'sara@assent.example' } });

    const holder = await seedBooking(aditi.id, assentId, 40);
    const unscoredDeclaredCarpool = await seedBooking(rahul.id, assentId, 5, 4);
    const soloHigherScore = await seedBooking(sara.id, assentId, 20);
    await runPrimaryAllocation(DATE);
    expect(await statusOf(holder.id)).toBe('ALLOCATED');
    expect(await statusOf(unscoredDeclaredCarpool.id)).toBe('WAITLISTED');
    expect(await statusOf(soloHigherScore.id)).toBe('WAITLISTED');

    const token = await login('aditi@assent.example');
    await request(app).post(`${API}/bookings/${holder.id}/release`).set(bearer(token)).send({}).expect(200);

    expect(await statusOf(soloHigherScore.id)).toBe('ALLOCATED');
    expect(await statusOf(unscoredDeclaredCarpool.id)).toBe('WAITLISTED');
  });

  it('expires waitlisted rows for users who already hold an allocation on that date', async () => {
    await capAssentQuotaTo(1);
    const aditi = await prisma.user.findFirstOrThrow({ where: { email: 'aditi@assent.example' } });
    const rahul = await prisma.user.findFirstOrThrow({ where: { email: 'rahul@assent.example' } });

    const holder = await seedBooking(aditi.id, assentId, 30);
    const rahulPrimaryWaitlist = await seedBooking(rahul.id, assentId, 10);
    await runPrimaryAllocation(DATE);
    expect(await statusOf(holder.id)).toBe('ALLOCATED');
    expect(await statusOf(rahulPrimaryWaitlist.id)).toBe('WAITLISTED');
    const freedSlot = await slotIdOf(holder.id);

    const takenSlotIds = (
      await prisma.parkingAllocation.findMany({ where: { bookingDate }, select: { slotId: true } })
    ).map((a) => a.slotId);
    const otherSlot = await prisma.parkingSlot.findFirstOrThrow({
      where: { deletedAt: null, status: 'AVAILABLE', id: { notIn: takenSlotIds } },
      orderBy: { slotNumber: 'asc' },
    });
    const rahulCommonPool = await prisma.bookingRequest.create({
      data: {
        bookingDate,
        userId: rahul.id,
        companyId: assentId,
        bookingType: 'COMMON_POOL',
        status: 'ALLOCATED',
        userAddress: 'Test address',
        pinCode: '411057',
        travelDistanceKm: 10,
        carpoolMemberCount: 0,
        submittedAt: new Date(),
        allocationTime: new Date(),
      },
    });
    await prisma.parkingAllocation.create({
      data: {
        bookingRequestId: rahulCommonPool.id,
        slotId: otherSlot.id,
        bookingDate,
        companyId: assentId,
        allocationType: 'COMMON_POOL',
      },
    });

    const token = await login('aditi@assent.example');
    await request(app).post(`${API}/bookings/${holder.id}/release`).set(bearer(token)).send({}).expect(200);

    expect(await statusOf(rahulPrimaryWaitlist.id)).toBe('EXPIRED');
    expect(await slotIdOf(rahulPrimaryWaitlist.id)).toBeNull();
    expect(await allocationCountForUser(rahul.id)).toBe(1);
    expect(await prisma.parkingAllocation.findFirst({ where: { slotId: freedSlot!, bookingDate } })).toBeNull();
  });

  it('falls through to the best-scoring other company when no own-company waitlist exists', async () => {
    await capAssentQuotaTo(1);
    const aditi = await prisma.user.findFirstOrThrow({ where: { email: 'aditi@assent.example' } });

    const holder = await seedBooking(aditi.id, assentId, 30);
    const other = await seedBooking(otherUserId, otherCompanyId, 40);
    await runPrimaryAllocation(DATE);
    expect(await statusOf(other.id)).toBe('WAITLISTED');

    const token = await login('aditi@assent.example');
    await request(app).post(`${API}/bookings/${holder.id}/release`).set(bearer(token)).send({}).expect(200);

    expect(await statusOf(other.id)).toBe('ALLOCATED');
    // Crossing the company boundary reclassifies the allocation as common-pool.
    const alloc = await prisma.parkingAllocation.findUniqueOrThrow({ where: { bookingRequestId: other.id } });
    expect(alloc.allocationType).toBe('COMMON_POOL');
    expect(alloc.companyId).toBe(otherCompanyId);
  });

  it('allocates the common-pool waitlist row and expires the duplicate primary waitlist row', async () => {
    await capAssentQuotaTo(1);
    const aditi = await prisma.user.findFirstOrThrow({ where: { email: 'aditi@assent.example' } });

    const holder = await seedBooking(aditi.id, assentId, 30);
    const otherPrimary = await seedBooking(otherUserId, otherCompanyId, 40);
    await runPrimaryAllocation(DATE);
    expect(await statusOf(otherPrimary.id)).toBe('WAITLISTED');
    const otherCommonPool = await seedCommonPoolWaitlist(otherUserId, otherCompanyId, 40);

    const token = await login('aditi@assent.example');
    await request(app).post(`${API}/bookings/${holder.id}/release`).set(bearer(token)).send({}).expect(200);

    expect(await statusOf(otherCommonPool.id)).toBe('ALLOCATED');
    expect(await statusOf(otherPrimary.id)).toBe('EXPIRED');
    expect(await allocationCountForUser(otherUserId)).toBe(1);
    const alloc = await prisma.parkingAllocation.findUniqueOrThrow({ where: { bookingRequestId: otherCommonPool.id } });
    expect(alloc.allocationType).toBe('COMMON_POOL');

    const admin = await login('superadmin@redbricks.example');
    const list = await request(app).get(`${API}/bookings`).query({ date: DATE, pageSize: 100 }).set(bearer(admin)).expect(200);
    const rows = list.body.data.filter((b: { employeeEmail: string }) => b.employeeEmail === OTHER_USER_EMAIL);
    expect(rows).toHaveLength(1);
    expect(rows[0].history).toHaveLength(2);
  });

  it('leaves the slot free when nobody is waitlisted', async () => {
    const aditi = await prisma.user.findFirstOrThrow({ where: { email: 'aditi@assent.example' } });
    const holder = await seedBooking(aditi.id, assentId, 30);
    await runPrimaryAllocation(DATE);
    const freedSlot = await slotIdOf(holder.id);

    const token = await login('aditi@assent.example');
    await request(app).post(`${API}/bookings/${holder.id}/release`).set(bearer(token)).send({}).expect(200);

    const stillTaken = await prisma.parkingAllocation.findFirst({ where: { slotId: freedSlot!, bookingDate } });
    expect(stillTaken).toBeNull();
  });
});
