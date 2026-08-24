import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { runPrimaryAllocation } from '../src/modules/allocation/allocation.service';
import { currentIstCalendarDate } from '../src/modules/bookings/bookings.time';
import { API, bearer, login, resetTransactional, futureBookableDate } from './integration/helpers';

/**
 * Last-minute handover (POST /bookings/{id}/reassign, 2026-08-23).
 *
 * The scenario: someone posts on Slack that they are not coming in, a colleague says they will take the
 * slot, and the company admin makes that official. The booking changes owner in place — same row, same
 * bay — so what these tests mostly police is that the *taker* ends up with exactly one slot and one
 * request, and that the guard at the barrier can still place whoever turns up.
 *
 * Bookings are seeded through Prisma rather than the API so the tests do not depend on the booking
 * window still being open for the chosen date (the same reason release-booking does it).
 */

const DATE = futureBookableDate();
const bookingDate = new Date(`${DATE}T00:00:00.000Z`);
/** The handover normally happens on the day itself, which is the one case the gate can also see. */
const today = currentIstCalendarDate();

let assentId: string;
let aditiId: string;
let rahulId: string;
let saraId: string;

const OTHER_COMPANY_CODE = 'SWAPCO';
const OTHER_USER_EMAIL = 'swapper@swapco.example';
let otherCompanyId: string;
let otherUserId: string;

async function seedBooking(
  userId: string,
  distanceKm: number,
  overrides: { date?: Date; status?: 'SUBMITTED' | 'ALLOCATED' | 'WAITLISTED'; vehicleNumber?: string } = {},
) {
  return prisma.bookingRequest.create({
    data: {
      bookingDate: overrides.date ?? bookingDate,
      userId,
      companyId: assentId,
      bookingType: 'PRIMARY',
      status: overrides.status ?? 'SUBMITTED',
      userAddress: 'Seeded address',
      pinCode: '411057',
      travelDistanceKm: distanceKm,
      vehicleNumber: overrides.vehicleNumber ?? null,
      carpoolMemberCount: 0,
      submittedAt: new Date(),
    },
  });
}

/** An already-allocated booking for a date, without running the allocation engine over it. */
async function seedAllocated(userId: string, date: Date, vehicleNumber?: string) {
  const booking = await seedBooking(userId, 15, { date, status: 'ALLOCATED', vehicleNumber });
  const takenSlotIds = (
    await prisma.parkingAllocation.findMany({ where: { bookingDate: date }, select: { slotId: true } })
  ).map((a) => a.slotId);
  const slot = await prisma.parkingSlot.findFirstOrThrow({
    where: { deletedAt: null, status: 'AVAILABLE', id: { notIn: takenSlotIds } },
    orderBy: { slotNumber: 'asc' },
  });
  await prisma.parkingAllocation.create({
    data: {
      bookingRequestId: booking.id,
      slotId: slot.id,
      bookingDate: date,
      companyId: assentId,
      allocationType: 'PRIMARY',
      allocatedAt: new Date(),
    },
  });
  return { booking, slotId: slot.id, slotNumber: slot.slotNumber };
}

/** Cap Assent's effective quota for DATE by blocking the rest, to force a waitlist. */
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

const bookingRow = (id: string) => prisma.bookingRequest.findUniqueOrThrow({ where: { id } });
const slotIdOf = async (bookingRequestId: string) =>
  (await prisma.parkingAllocation.findUnique({ where: { bookingRequestId } }))?.slotId ?? null;

beforeAll(async () => {
  assentId = (await prisma.company.findFirstOrThrow({ where: { code: 'ASSENT' } })).id;
  aditiId = (await prisma.user.findFirstOrThrow({ where: { email: 'aditi@assent.example' } })).id;
  rahulId = (await prisma.user.findFirstOrThrow({ where: { email: 'rahul@assent.example' } })).id;
  saraId = (await prisma.user.findFirstOrThrow({ where: { email: 'sara@assent.example' } })).id;

  // A second tenant, so "the taker must be a colleague" has something to refuse.
  otherCompanyId = (
    await prisma.company.upsert({
      where: { code: OTHER_COMPANY_CODE },
      update: {},
      create: { code: OTHER_COMPANY_CODE, name: 'Swap Co', status: 'ACTIVE' },
    })
  ).id;
  otherUserId = (
    await prisma.user.upsert({
      where: { email: OTHER_USER_EMAIL },
      update: { companyId: otherCompanyId },
      create: {
        email: OTHER_USER_EMAIL,
        fullName: 'Swap Co Person',
        passwordHash: 'x', // never logs in
        contactNumber: '9000000888',
        address: 'Elsewhere',
        pinCode: '400001',
        distanceKm: 20,
        status: 'ACTIVE',
        companyId: otherCompanyId,
      },
    })
  ).id;
});

beforeEach(async () => {
  await resetTransactional();
  await prisma.auditLog.deleteMany({ where: { actionType: 'BOOKING_REASSIGNED' } });
});

afterAll(async () => {
  await resetTransactional();
  await prisma.user.deleteMany({ where: { email: OTHER_USER_EMAIL } });
  await prisma.company.deleteMany({ where: { code: OTHER_COMPANY_CODE } });
  await prisma.$disconnect();
});

describe('POST /bookings/:id/reassign — the slot changes hands', () => {
  it('moves the booking to the taker, keeping the same slot', async () => {
    const { booking, slotId } = await seedAllocated(aditiId, bookingDate);
    const admin = await login('admin@assent.example');

    const res = await request(app)
      .post(`${API}/bookings/${booking.id}/reassign`)
      .set(bearer(admin))
      .send({ toUserId: rahulId, reason: 'Aditi WFH, Rahul asked on Slack' })
      .expect(200);

    expect(res.body.data.status).toBe('ALLOCATED');
    expect(res.body.data.reassignedFromName).toBe('Aditi Rao');
    expect(res.body.data.reassignedFromEmail).toBe('aditi@assent.example');
    expect(res.body.data.reassignmentReason).toBe('Aditi WFH, Rahul asked on Slack');

    const after = await bookingRow(booking.id);
    expect(after.userId).toBe(rahulId);
    expect(await slotIdOf(booking.id)).toBe(slotId); // same physical bay
    // Re-snapshotted from the taker's profile (F6) rather than left as the original booker's.
    expect(after.pinCode).toBe('411014');
    expect(Number(after.travelDistanceKm)).toBeCloseTo(24.8, 1);
  });

  it('flags the allocation as a manual override so the roster says where the slot came from', async () => {
    const { booking } = await seedAllocated(aditiId, bookingDate);
    const admin = await login('admin@assent.example');
    const adminId = (await prisma.user.findFirstOrThrow({ where: { email: 'admin@assent.example' } })).id;

    await request(app)
      .post(`${API}/bookings/${booking.id}/reassign`)
      .set(bearer(admin))
      .send({ toUserId: rahulId })
      .expect(200);

    const alloc = await prisma.parkingAllocation.findUniqueOrThrow({ where: { bookingRequestId: booking.id } });
    expect(alloc.isManualOverride).toBe(true);
    expect(alloc.overrideById).toBe(adminId);

    const list = await request(app).get(`${API}/bookings`).query({ date: DATE }).set(bearer(admin)).expect(200);
    const row = list.body.data.find((b: { id: string }) => b.id === booking.id);
    expect(row.allocationSource).toBe('MANUAL_OVERRIDE');
    expect(row.employeeEmail).toBe('rahul@assent.example');
    expect(row.reassignedFromName).toBe('Aditi Rao');
  });

  it('consumes the taker’s own waitlisted request so they do not hold two rows', async () => {
    await capAssentQuotaTo(1);
    const winner = await seedBooking(aditiId, 30);
    const waiting = await seedBooking(rahulId, 10);
    await runPrimaryAllocation(DATE);
    expect((await bookingRow(winner.id)).status).toBe('ALLOCATED');
    expect((await bookingRow(waiting.id)).status).toBe('WAITLISTED');

    const admin = await login('admin@assent.example');
    await request(app)
      .post(`${API}/bookings/${winner.id}/reassign`)
      .set(bearer(admin))
      .send({ toUserId: rahulId })
      .expect(200);

    // The waitlisted row would collide with unique(userId, bookingDate, bookingType) — it is removed,
    // and its prior state survives in the audit log instead.
    expect(await prisma.bookingRequest.findUnique({ where: { id: waiting.id } })).toBeNull();
    const rahulRows = await prisma.bookingRequest.findMany({ where: { userId: rahulId, bookingDate } });
    expect(rahulRows).toHaveLength(1);
    expect(rahulRows[0].id).toBe(winner.id);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { actionType: 'BOOKING_REASSIGNED' } });
    const oldValue = audit.oldValue as { takerExistingRequest: { id: string; status: string } | null };
    expect(oldValue.takerExistingRequest?.id).toBe(waiting.id);
    expect(oldValue.takerExistingRequest?.status).toBe('WAITLISTED');
  });

  it('expires the taker’s other-type live request so the common-pool run cannot double-allocate', async () => {
    const { booking } = await seedAllocated(aditiId, bookingDate);
    const rahulCommonPool = await prisma.bookingRequest.create({
      data: {
        bookingDate,
        userId: rahulId,
        companyId: assentId,
        bookingType: 'COMMON_POOL',
        status: 'WAITLISTED',
        userAddress: 'Seeded address',
        pinCode: '411014',
        travelDistanceKm: 24.8,
        carpoolMemberCount: 0,
        submittedAt: new Date(),
      },
    });

    const admin = await login('admin@assent.example');
    await request(app)
      .post(`${API}/bookings/${booking.id}/reassign`)
      .set(bearer(admin))
      .send({ toUserId: rahulId })
      .expect(200);

    const after = await bookingRow(rahulCommonPool.id);
    expect(after.status).toBe('EXPIRED');
    expect(after.cancellationReason).toBe('Superseded by a reassigned slot');
  });

  it('clears the original driver’s declared carpool', async () => {
    const { booking } = await seedAllocated(aditiId, bookingDate);
    await prisma.bookingRequest.update({ where: { id: booking.id }, data: { carpoolMemberCount: 1 } });
    await prisma.bookingCarpoolMember.create({
      data: {
        bookingRequestId: booking.id,
        bookingDate,
        name: 'Sara Khan',
        employeeEmail: 'sara@assent.example',
        employeeUserId: saraId,
        sameCompany: true,
        isScored: true,
      },
    });

    const admin = await login('admin@assent.example');
    const res = await request(app)
      .post(`${API}/bookings/${booking.id}/reassign`)
      .set(bearer(admin))
      .send({ toUserId: rahulId })
      .expect(200);

    expect(res.body.data.carpoolMembers).toHaveLength(0);
    expect((await bookingRow(booking.id)).carpoolMemberCount).toBe(0);
  });
});

describe('POST /bookings/:id/reassign — the car at the barrier', () => {
  it('falls back to the taker’s registered car when no plate is given', async () => {
    const { booking } = await seedAllocated(aditiId, bookingDate, 'MH 12 AB 1234');
    const admin = await login('admin@assent.example');

    await request(app)
      .post(`${API}/bookings/${booking.id}/reassign`)
      .set(bearer(admin))
      .send({ toUserId: rahulId })
      .expect(200);

    // Rahul's seeded car, not Aditi's — a stale plate would point the guard at the wrong person.
    expect((await bookingRow(booking.id)).vehicleNumber).toBe('MH 12 CD 5678');
  });

  it('records an explicitly given plate and adds it to the registry', async () => {
    const { booking } = await seedAllocated(aditiId, bookingDate, 'MH 12 AB 1234');
    const admin = await login('admin@assent.example');

    await request(app)
      .post(`${API}/bookings/${booking.id}/reassign`)
      .set(bearer(admin))
      .send({ toUserId: rahulId, vehicleNumber: 'MH 12 ZZ 9999' })
      .expect(200);

    expect((await bookingRow(booking.id)).vehicleNumber).toBe('MH 12 ZZ 9999');
    const registered = await prisma.vehicle.findFirst({ where: { vehicleNumber: 'MH12ZZ9999' } });
    expect(registered?.userId).toBe(rahulId);

    await prisma.vehicle.deleteMany({ where: { vehicleNumber: 'MH12ZZ9999' } });
  });

  it('lets the gate place the taker on the day of the swap', async () => {
    const { booking, slotNumber } = await seedAllocated(aditiId, today, 'MH 12 AB 1234');
    const admin = await login('admin@assent.example');
    await request(app)
      .post(`${API}/bookings/${booking.id}/reassign`)
      .set(bearer(admin))
      .send({ toUserId: rahulId })
      .expect(200);

    const guard = await login('security@redbricks.example');
    const lookup = await request(app)
      .get(`${API}/vehicles/lookup`)
      .query({ number: 'MH12CD5678' })
      .set(bearer(guard))
      .expect(200);

    expect(lookup.body.data.hasBooking).toBe(true);
    expect(lookup.body.data.booking.employeeName).toBe('Rahul Mehta');
    expect(lookup.body.data.booking.allocatedSlotNumber).toBe(slotNumber);
  });
});

describe('POST /bookings/:id/reassign — refusals', () => {
  it('refuses a booking that holds no slot (409)', async () => {
    const booking = await seedBooking(aditiId, 12); // SUBMITTED, never allocated
    const admin = await login('admin@assent.example');
    await request(app)
      .post(`${API}/bookings/${booking.id}/reassign`)
      .set(bearer(admin))
      .send({ toUserId: rahulId })
      .expect(409);
  });

  it('refuses a date that has already passed (409)', async () => {
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const { booking } = await seedAllocated(aditiId, yesterday);
    const admin = await login('admin@assent.example');
    await request(app)
      .post(`${API}/bookings/${booking.id}/reassign`)
      .set(bearer(admin))
      .send({ toUserId: rahulId })
      .expect(409);
  });

  it('refuses when the taker already holds a slot for that date (409)', async () => {
    const { booking } = await seedAllocated(aditiId, bookingDate);
    await seedAllocated(rahulId, bookingDate);
    const admin = await login('admin@assent.example');
    const res = await request(app)
      .post(`${API}/bookings/${booking.id}/reassign`)
      .set(bearer(admin))
      .send({ toUserId: rahulId })
      .expect(409);
    expect(res.body.error.message).toMatch(/already has a slot/i);
  });

  it('refuses when the original booker is already checked in (409)', async () => {
    const { booking } = await seedAllocated(aditiId, today, 'MH 12 AB 1234');
    const guard = await login('security@redbricks.example');
    await request(app)
      .post(`${API}/gate/check-in`)
      .set(bearer(guard))
      .send({ vehicleNumber: 'MH12AB1234' })
      .expect(201);

    const admin = await login('admin@assent.example');
    const res = await request(app)
      .post(`${API}/bookings/${booking.id}/reassign`)
      .set(bearer(admin))
      .send({ toUserId: rahulId })
      .expect(409);
    expect(res.body.error.message).toMatch(/already checked in/i);
  });

  it('refuses a taker from another company (400)', async () => {
    const { booking } = await seedAllocated(aditiId, bookingDate);
    const admin = await login('admin@assent.example');
    const res = await request(app)
      .post(`${API}/bookings/${booking.id}/reassign`)
      .set(bearer(admin))
      .send({ toUserId: otherUserId })
      .expect(400);
    expect(res.body.error.details[0].field).toBe('toUserId');
  });

  it('refuses handing a booking to the person who already owns it (400)', async () => {
    const { booking } = await seedAllocated(aditiId, bookingDate);
    const admin = await login('admin@assent.example');
    await request(app)
      .post(`${API}/bookings/${booking.id}/reassign`)
      .set(bearer(admin))
      .send({ toUserId: aditiId })
      .expect(400);
  });

  it('is closed to a plain USER (403) and to the Super Admin (403)', async () => {
    const { booking } = await seedAllocated(aditiId, bookingDate);
    const aditi = await login('aditi@assent.example');
    await request(app)
      .post(`${API}/bookings/${booking.id}/reassign`)
      .set(bearer(aditi))
      .send({ toUserId: rahulId })
      .expect(403);

    // COMPANY_ADMIN only, by decision (2026-08-23): the handover is the tenant's own people-shuffle.
    const superAdmin = await login('superadmin@redbricks.example');
    await request(app)
      .post(`${API}/bookings/${booking.id}/reassign`)
      .set(bearer(superAdmin))
      .send({ toUserId: rahulId })
      .expect(403);
  });
});
