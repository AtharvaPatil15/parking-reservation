import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { getString, getNumber } from '../../config/systemConfig';
import { ValidationError, ConflictError, NotFoundError, WindowClosedError } from '../../lib/errors';
import {
  isValidCalendarDate,
  isBookableWeekday,
  isBeforePrimaryCutoff,
  parseCalendarDate,
  currentIstCalendarDate,
} from './bookings.time';
import { score, rankCandidates } from '../allocation/score';
import { buildAuditData } from '../../lib/audit';
import type { PageArgs } from '../../lib/pagination';
import type {
  CreateBookingInput,
  UpdateBookingInput,
  ListBookingsQuery,
  ReleaseBookingInput,
} from './bookings.schema';

const DEFAULT_PRIMARY_CUTOFF = '18:00';
const DEFAULT_MAX_PEOPLE = 4;
// Mirror the allocation run's fallbacks so a release scores identically to the run (decisions §3).
const DEFAULT_DISTANCE_WEIGHT = 0.6;
const DEFAULT_CARPOOL_WEIGHT = 0.4;
const DEFAULT_MAX_DISTANCE_KM = 40;
const STATUS_PRIORITY: Record<string, number> = {
  ALLOCATED: 0,
  WAITLISTED: 1,
  SUBMITTED: 2,
  DRAFT: 3,
  RELEASED: 4,
  EXPIRED: 5,
  CANCELLED: 6,
  REJECTED: 7,
};

/** Authenticated principal (matches req.user). */
export interface Principal {
  id: string;
  role: 'SUPER_ADMIN' | 'COMPANY_ADMIN' | 'USER';
  companyId: string;
}

type AdminBookingRow = Prisma.BookingRequestGetPayload<{
  include: {
    user: { select: { fullName: true; email: true } };
    company: { select: { name: true } };
    allocation: { include: { slot: { select: { slotNumber: true } } } };
  };
}>;

const fail = (field: string, message: string): never => {
  throw new ValidationError('Request validation failed', [{ field, message }]);
};

const groupKey = (b: AdminBookingRow) => `${b.companyId}:${b.user.email.toLowerCase()}:${b.bookingDate.toISOString().slice(0, 10)}`;
const rowTime = (b: AdminBookingRow) => (b.createdAt ?? b.submittedAt ?? new Date(0)).getTime();
const currentHistoryRow = (rows: AdminBookingRow[]) =>
  [...rows].sort((a, b) => {
    const status = (STATUS_PRIORITY[a.status] ?? 99) - (STATUS_PRIORITY[b.status] ?? 99);
    if (status !== 0) return status;
    return rowTime(b) - rowTime(a);
  })[0];

async function withSerializableRetry<T>(work: (tx: Prisma.TransactionClient) => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(work, { isolationLevel: 'Serializable', timeout: 30_000 });
    } catch (error) {
      lastError = error;
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || attempt === maxAttempts) {
        throw error;
      }
    }
  }
  throw lastError;
}

/**
 * Create a submitted PRIMARY booking for the current user (P4-12).
 * Snapshots distance/address from the profile (F6); records carpool members, flagging only
 * validated same-company employees as scored (F4). Rejects non-weekday / past-cutoff dates
 * (422 WINDOW_CLOSED) and a duplicate same-type request for the date (409 CONFLICT).
 * `now` is injectable for testing.
 */
export async function createBooking(userId: string, input: CreateBookingInput, now: Date = new Date()) {
  // 1. Date validity + bookable weekday (D7).
  if (!isValidCalendarDate(input.bookingDate)) fail('bookingDate', 'Not a valid calendar date');
  if (!isBookableWeekday(input.bookingDate)) {
    throw new WindowClosedError('Booking date must be a bookable weekday (Mon–Fri)');
  }

  // 2. Primary cutoff window (F1/F2) — read live config (D8).
  const cutoff = (await getString('booking.primaryCutoff')) ?? DEFAULT_PRIMARY_CUTOFF;
  if (!isBeforePrimaryCutoff(now, input.bookingDate, cutoff)) {
    throw new WindowClosedError(
      `Primary booking window for ${input.bookingDate} has closed (cutoff ${cutoff} IST on the preceding day)`,
    );
  }

  // 3. Carpool headcount cap (D8) and member/seat consistency.
  const maxPeople = (await getNumber('carpool.maxPeople')) ?? DEFAULT_MAX_PEOPLE;
  if (input.carpoolPeople > maxPeople) {
    fail('carpoolPeople', `Must be between 1 and ${maxPeople}`);
  }
  const members = input.carpoolMembers ?? [];
  if (members.length > input.carpoolPeople - 1) {
    fail('carpoolMembers', `Cannot list more members than carpoolPeople - 1 (${input.carpoolPeople - 1})`);
  }

  // 3b. Dedupe member emails within the request, case-insensitively (F4).
  const trimmedEmails = members
    .map((m) => m.employeeEmail?.trim())
    .filter((e): e is string => !!e);
  const lowered = trimmedEmails.map((e) => e.toLowerCase());
  const firstDupe = lowered.find((e, i) => lowered.indexOf(e) !== i);
  if (firstDupe) fail('carpoolMembers', `Duplicate carpool member email: ${firstDupe}`);

  // 4. Load the user for the distance/address snapshot (F6).
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError('User not found');

  // 5. Resolve which members are same-company ACTIVE employees → scored (F4).
  const employees = trimmedEmails.length
    ? await prisma.user.findMany({
        where: { companyId: user.companyId, status: 'ACTIVE', email: { in: trimmedEmails } },
        select: { id: true, email: true },
      })
    : [];
  const employeeIdByEmail = new Map(employees.map((e) => [e.email.toLowerCase(), e.id]));

  const bookingDateUtc = parseCalendarDate(input.bookingDate);
  const memberRows = members.map((m) => {
    const email = m.employeeEmail?.trim() || null;
    const employeeUserId = email ? employeeIdByEmail.get(email.toLowerCase()) ?? null : null;
    const scored = employeeUserId !== null;
    return {
      bookingDate: bookingDateUtc,
      name: m.name,
      employeeEmail: email,
      employeeUserId,
      contactNumber: m.contactNumber ?? null,
      pickupLocation: m.pickupLocation ?? null,
      sameCompany: scored,
      isScored: scored,
    };
  });

  // 6. Reject a duplicate same-type request up front for a clean 409 (DB unique is the backstop).
  const duplicate = await prisma.bookingRequest.findUnique({
    where: {
      userId_bookingDate_bookingType: {
        userId: user.id,
        bookingDate: bookingDateUtc,
        bookingType: 'PRIMARY',
      },
    },
    select: { id: true },
  });
  if (duplicate) throw new ConflictError('You already have a PRIMARY booking for this date');

  // 7. Create booking + carpool members atomically. Status = SUBMITTED (this is the submit endpoint).
  try {
    return await prisma.bookingRequest.create({
      data: {
        bookingDate: bookingDateUtc,
        userId: user.id,
        companyId: user.companyId,
        bookingType: 'PRIMARY',
        status: 'SUBMITTED',
        userAddress: user.address,
        pinCode: user.pinCode,
        travelDistanceKm: user.distanceKm, // Decimal | null — snapshot (F6)
        vehicleType: input.vehicleType ?? null,
        vehicleNumber: input.vehicleNumber ?? null,
        carpoolMemberCount: input.carpoolPeople - 1,
        specialRequirement: input.specialRequirement ?? null,
        submittedAt: now,
        carpoolMembers: memberRows.length ? { create: memberRows } : undefined,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const target = Array.isArray(err.meta?.target)
        ? (err.meta.target as string[]).join(',')
        : String(err.meta?.target ?? '');
      if (target.toLowerCase().includes('email')) {
        throw new ConflictError('A carpool member is already part of another booking for this date');
      }
      throw new ConflictError('You already have a PRIMARY booking for this date');
    }
    throw err;
  }
}

/**
 * Edit an own, still-pending booking before the primary cutoff (PATCH /bookings/{id}). Partial:
 * vehicle, carpool headcount, special requirement, and (optionally) the carpool member list.
 * Distance stays snapshotted (F6) — not editable. Rejects edits once the request is no longer
 * SUBMITTED/DRAFT or the window has closed (422). `now` is injectable for testing.
 */
export async function updateBooking(
  userId: string,
  bookingId: string,
  input: UpdateBookingInput,
  now: Date = new Date(),
) {
  const booking = await prisma.bookingRequest.findUnique({
    where: { id: bookingId },
    include: { carpoolMembers: true },
  });
  // Hide existence from non-owners (consistent with GET) — 404, not 403.
  if (!booking || booking.userId !== userId) throw new NotFoundError('Booking not found');
  if (booking.status !== 'SUBMITTED' && booking.status !== 'DRAFT') {
    throw new WindowClosedError('This booking can no longer be edited');
  }

  // Editable only while the primary window is still open (F2) — read live config (D8).
  const cutoff = (await getString('booking.primaryCutoff')) ?? DEFAULT_PRIMARY_CUTOFF;
  const bookingDateIso = booking.bookingDate.toISOString().slice(0, 10);
  if (!isBeforePrimaryCutoff(now, bookingDateIso, cutoff)) {
    throw new WindowClosedError(
      `Editing closed — the primary window for ${bookingDateIso} has passed (cutoff ${cutoff} IST)`,
    );
  }

  // Resulting headcount (driver = person 1). Cap against live config (D8).
  const maxPeople = (await getNumber('carpool.maxPeople')) ?? DEFAULT_MAX_PEOPLE;
  const nextPeople = input.carpoolPeople ?? booking.carpoolMemberCount + 1;
  if (nextPeople > maxPeople) fail('carpoolPeople', `Must be between 1 and ${maxPeople}`);

  // Resolve replacement members if provided; else keep existing (but ensure they still fit).
  let memberRows: Array<{
    bookingRequestId: string;
    bookingDate: Date;
    name: string;
    employeeEmail: string | null;
    employeeUserId: string | null;
    contactNumber: string | null;
    pickupLocation: string | null;
    sameCompany: boolean;
    isScored: boolean;
  }> | null = null;

  if (input.carpoolMembers) {
    const members = input.carpoolMembers;
    if (members.length > nextPeople - 1) {
      fail('carpoolMembers', `Cannot list more members than carpoolPeople - 1 (${nextPeople - 1})`);
    }
    const trimmedEmails = members.map((m) => m.employeeEmail?.trim()).filter((e): e is string => !!e);
    const lowered = trimmedEmails.map((e) => e.toLowerCase());
    const firstDupe = lowered.find((e, i) => lowered.indexOf(e) !== i);
    if (firstDupe) fail('carpoolMembers', `Duplicate carpool member email: ${firstDupe}`);
    const employees = trimmedEmails.length
      ? await prisma.user.findMany({
          where: { companyId: booking.companyId, status: 'ACTIVE', email: { in: trimmedEmails } },
          select: { id: true, email: true },
        })
      : [];
    const employeeIdByEmail = new Map(employees.map((e) => [e.email.toLowerCase(), e.id]));
    memberRows = members.map((m) => {
      const email = m.employeeEmail?.trim() || null;
      const employeeUserId = email ? employeeIdByEmail.get(email.toLowerCase()) ?? null : null;
      const scored = employeeUserId !== null;
      return {
        bookingRequestId: bookingId,
        bookingDate: booking.bookingDate,
        name: m.name,
        employeeEmail: email,
        employeeUserId,
        contactNumber: m.contactNumber ?? null,
        pickupLocation: m.pickupLocation ?? null,
        sameCompany: scored,
        isScored: scored,
      };
    });
  } else if (input.carpoolPeople != null && booking.carpoolMembers.length > nextPeople - 1) {
    fail('carpoolPeople', `Remove carpool members first — you have ${booking.carpoolMembers.length}`);
  }

  const data: Prisma.BookingRequestUpdateInput = {};
  if (input.vehicleType !== undefined) data.vehicleType = input.vehicleType ?? null;
  if (input.vehicleNumber !== undefined) data.vehicleNumber = input.vehicleNumber ?? null;
  if (input.specialRequirement !== undefined) data.specialRequirement = input.specialRequirement ?? null;
  if (input.carpoolPeople != null) data.carpoolMemberCount = nextPeople - 1;

  try {
    await prisma.$transaction(async (tx) => {
      if (memberRows) {
        await tx.bookingCarpoolMember.deleteMany({ where: { bookingRequestId: bookingId } });
        if (memberRows.length) await tx.bookingCarpoolMember.createMany({ data: memberRows });
      }
      if (Object.keys(data).length) await tx.bookingRequest.update({ where: { id: bookingId }, data });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError('A carpool member is already part of another booking for this date');
    }
    throw err;
  }

  return getBookingForPrincipal({ id: userId, role: 'USER', companyId: booking.companyId }, bookingId);
}

/**
 * Release an allocated slot and immediately hand it to the best waitlisted candidate (F3).
 *
 * Cascade (spec §F3, refined): the freed slot is offered to the *releasing user's own company*
 * waitlist first — own-company waitlisters get right of first refusal regardless of score, because
 * the slot came out of that company's quota. Only if nobody from that company is waitlisted does the
 * slot cross the company boundary, and then it goes to the highest-ranked waitlisted request across
 * all other companies (same scoring + tie-breakers as the allocation run). If nobody is waitlisted
 * at all, the slot simply becomes free and the common-pool run will pick it up.
 *
 * The whole thing is one SERIALIZABLE transaction: the old allocation row is deleted and the new one
 * created together, so the unique (slotId, bookingDate) constraint can never see a double-booking,
 * and a concurrent release can't hand the same slot to two people.
 */
export async function releaseBooking(
  principal: Principal,
  bookingId: string,
  input: ReleaseBookingInput = {},
  now: Date = new Date(),
) {
  const booking = await prisma.bookingRequest.findUnique({
    where: { id: bookingId },
    include: { allocation: true },
  });
  // Hide existence from non-owners (consistent with GET/PATCH) — 404, not 403.
  if (!booking) throw new NotFoundError('Booking not found');
  if (principal.role === 'USER' && booking.userId !== principal.id) {
    throw new NotFoundError('Booking not found');
  }
  if (principal.role === 'COMPANY_ADMIN' && booking.companyId !== principal.companyId) {
    throw new NotFoundError('Booking not found');
  }
  if (booking.status !== 'ALLOCATED' || !booking.allocation) {
    throw new ConflictError('Only an allocated booking can be released');
  }
  // A past date is already spent — there is nothing left to reallocate (KI-1).
  if (booking.bookingDate.getTime() < currentIstCalendarDate(now).getTime()) {
    throw new ConflictError('This booking date has passed and can no longer be released');
  }

  const { bookingDate, companyId: releasingCompanyId } = booking;

  const [dw, cw, maxD, maxP] = await Promise.all([
    getNumber('allocation.distanceWeight'),
    getNumber('allocation.carpoolWeight'),
    getNumber('allocation.maxDistanceKm'),
    getNumber('carpool.maxPeople'),
  ]);
  const weights = { distanceWeight: dw ?? DEFAULT_DISTANCE_WEIGHT, carpoolWeight: cw ?? DEFAULT_CARPOOL_WEIGHT };
  const caps = { maxDistanceKm: maxD ?? DEFAULT_MAX_DISTANCE_KM, maxPeople: maxP ?? DEFAULT_MAX_PEOPLE };

  await withSerializableRetry(async (tx) => {
      const liveBooking = await tx.bookingRequest.findUnique({
        where: { id: bookingId },
        include: { allocation: true },
      });
      if (!liveBooking || liveBooking.status !== 'ALLOCATED' || !liveBooking.allocation) {
        throw new ConflictError('Only an allocated booking can be released');
      }
      const freedSlotId = liveBooking.allocation.slotId;

      // 1. Free the slot: drop the allocation and mark the request RELEASED.
      const deletedAllocation = await tx.parkingAllocation.deleteMany({ where: { bookingRequestId: bookingId } });
      if (deletedAllocation.count !== 1) {
        throw new ConflictError('Only an allocated booking can be released');
      }
      await tx.bookingRequest.update({
        where: { id: bookingId },
        data: {
          status: 'RELEASED',
          cancellationTime: now,
          cancellationReason: input.reason ?? null,
        },
      });

      // 2. Candidate pool: everyone still waitlisted for this date (either booking type),
      // excluding users who already hold another allocation for the same day.
      const allocatedUserIds = (
        await tx.parkingAllocation.findMany({
          where: { bookingDate },
          select: { bookingRequest: { select: { userId: true } } },
        })
      ).map((a) => a.bookingRequest.userId);
      const allocatedUserIdSet = [...new Set(allocatedUserIds)];
      if (allocatedUserIdSet.length) {
        await tx.bookingRequest.updateMany({
          where: { bookingDate, status: 'WAITLISTED', userId: { in: allocatedUserIdSet } },
          data: {
            status: 'EXPIRED',
            cancellationReason: 'Superseded by same-day allocation',
          },
        });
      }
      const waitlisted = await tx.bookingRequest.findMany({
        where: {
          bookingDate,
          status: 'WAITLISTED',
          id: { not: bookingId },
          ...(allocatedUserIdSet.length ? { userId: { notIn: allocatedUserIdSet } } : {}),
        },
        include: { carpoolMembers: { where: { isScored: true }, select: { id: true } } },
      });

      // 3. Own-company first refusal; only if that tier is empty do we look cross-company.
      const ownCompany = waitlisted.filter((w) => w.companyId === releasingCompanyId);
      const rawTier = ownCompany.length > 0 ? ownCompany : waitlisted;
      const preferredBookingType = ownCompany.length > 0 ? 'PRIMARY' : 'COMMON_POOL';
      const tierByUser = new Map<string, (typeof rawTier)[number]>();
      for (const w of rawTier) {
        const existing = tierByUser.get(w.userId);
        if (!existing || (existing.bookingType !== preferredBookingType && w.bookingType === preferredBookingType)) {
          tierByUser.set(w.userId, w);
        }
      }
      const tier = [...tierByUser.values()];
      if (tier.length === 0) {
        await tx.auditLog.create({
          data: buildAuditData({
            actionType: 'BOOKING_RELEASED',
            entityType: 'BookingRequest',
            entityId: bookingId,
            oldValue: { status: 'ALLOCATED', slotId: freedSlotId },
            newValue: { status: 'RELEASED', reallocatedTo: null, reason: input.reason ?? null },
          }),
        });
        return;
      }

      // 4. Rank the chosen tier exactly as the allocation run does (score → tie-breakers 1–5).
      const d30 = new Date(bookingDate);
      d30.setUTCDate(d30.getUTCDate() - 30);
      const prev30 = new Map<string, number>();
      for (const userId of new Set(tier.map((w) => w.userId))) {
        prev30.set(
          userId,
          await tx.parkingAllocation.count({
            where: { bookingDate: { gte: d30, lt: bookingDate }, bookingRequest: { userId } },
          }),
        );
      }

      const candidates = tier.map((w) => {
        // PRIMARY rows score only validated same-company members; COMMON_POOL rows carry that snapshot.
        const scoredMemberCount = w.bookingType === 'PRIMARY' ? w.carpoolMembers.length : w.carpoolMemberCount;
        const people = 1 + scoredMemberCount;
        const distanceKm = w.travelDistanceKm != null ? Number(w.travelDistanceKm) : 0;
        const breakdown = score({ distanceKm, people }, weights, caps);
        return {
          bookingId: w.id,
          userId: w.userId,
          companyId: w.companyId,
          bookingType: w.bookingType,
          breakdown,
          finalScore: breakdown.finalScore,
          people,
          distanceKm,
          submittedAt: w.submittedAt ?? w.createdAt,
          allocationsPrev30d: prev30.get(w.userId) ?? 0,
        };
      });

      const winner = rankCandidates(candidates)[0].candidate;

      // 5. Hand the freed slot over. Staying inside the company keeps it a PRIMARY allocation;
      //    crossing a company boundary makes it a COMMON_POOL one (the slot left its quota).
      await tx.parkingAllocation.create({
        data: {
          bookingRequestId: winner.bookingId,
          slotId: freedSlotId,
          bookingDate,
          companyId: winner.companyId,
          allocationType: winner.companyId === releasingCompanyId ? 'PRIMARY' : 'COMMON_POOL',
        },
      });
      await tx.bookingRequest.update({
        where: { id: winner.bookingId },
        data: {
          status: 'ALLOCATED',
          allocationScore: winner.breakdown.finalScore,
          allocationTime: now,
        },
      });
      const existingBreakdown = await tx.allocationScoreBreakdown.findUnique({
        where: { bookingRequestId: winner.bookingId },
        select: { id: true, tieBreakerData: true },
      });
      if (existingBreakdown) {
        await tx.allocationScoreBreakdown.update({
          where: { id: existingBreakdown.id },
          data: {
            distanceScore: winner.breakdown.distanceScore,
            carpoolScore: winner.breakdown.carpoolScore,
            distanceWeight: winner.breakdown.distanceWeight,
            carpoolWeight: winner.breakdown.carpoolWeight,
            finalScore: winner.breakdown.finalScore,
            travellerCount: winner.people,
            tieBreakerData: {
              ...(typeof existingBreakdown.tieBreakerData === 'object' && existingBreakdown.tieBreakerData !== null
                ? existingBreakdown.tieBreakerData
                : {}),
              releaseReallocation: {
                sourceBookingId: bookingId,
                slotId: freedSlotId,
                bookingType: winner.bookingType,
                people: winner.people,
                distanceKm: winner.distanceKm,
                submittedAt: (winner.submittedAt instanceof Date ? winner.submittedAt : new Date(winner.submittedAt)).toISOString(),
                allocationsPrev30d: winner.allocationsPrev30d,
                computedAt: now.toISOString(),
              },
            },
          },
        });
      }
      const superseded = await tx.bookingRequest.updateMany({
        where: {
          bookingDate,
          userId: winner.userId,
          status: 'WAITLISTED',
          id: { not: winner.bookingId },
        },
        data: {
          status: 'EXPIRED',
          cancellationReason: 'Superseded by released slot allocation',
        },
      });

      await tx.auditLog.create({
        data: buildAuditData({
          actionType: 'BOOKING_RELEASED',
          entityType: 'BookingRequest',
          entityId: bookingId,
          oldValue: { status: 'ALLOCATED', slotId: freedSlotId },
          newValue: {
            status: 'RELEASED',
            reason: input.reason ?? null,
            reallocatedTo: winner.bookingId,
            reallocatedCompanyId: winner.companyId,
            sameCompany: winner.companyId === releasingCompanyId,
            finalScore: winner.breakdown.finalScore,
            supersededWaitlistCount: superseded.count,
          },
        }),
      });
    });

  return getBookingForPrincipal(principal, bookingId);
}

/**
 * Fetch a booking with its carpool members, allocated slot, and score breakdown, enforcing
 * resource-level visibility: USER sees only their own; COMPANY_ADMIN only their company's;
 * SUPER_ADMIN any. Not-visible resolves to 404 (never leaks existence — openapi §/bookings/{id}).
 */
export async function getBookingForPrincipal(principal: Principal, bookingId: string) {
  const booking = await prisma.bookingRequest.findUnique({
    where: { id: bookingId },
    include: {
      carpoolMembers: true,
      allocation: { include: { slot: true } },
      scoreBreakdown: true,
    },
  });
  if (!booking) throw new NotFoundError('Booking not found');
  if (principal.role === 'USER' && booking.userId !== principal.id) {
    throw new NotFoundError('Booking not found');
  }
  if (principal.role === 'COMPANY_ADMIN' && booking.companyId !== principal.companyId) {
    throw new NotFoundError('Booking not found');
  }
  return booking;
}

/**
 * List bookings for an admin, newest first, with who/when/status/slot for each. Visibility:
 * COMPANY_ADMIN is forced to their own company (the `companyId` filter is ignored); SUPER_ADMIN
 * sees all companies and may narrow with `companyId`. Optional `date`/`status` filters.
 */
export async function listBookings(principal: Principal, filter: ListBookingsQuery, page: PageArgs) {
  const where: Prisma.BookingRequestWhereInput = {};
  // Tenant scoping: CA is locked to their own company; SA may optionally filter by one.
  if (principal.role === 'COMPANY_ADMIN') where.companyId = principal.companyId;
  else if (filter.companyId) where.companyId = filter.companyId;
  if (filter.date) where.bookingDate = parseCalendarDate(filter.date);
  if (filter.status) where.status = filter.status;

  const rows = await prisma.bookingRequest.findMany({
    where,
    include: {
      user: { select: { fullName: true, email: true } },
      company: { select: { name: true } },
      allocation: { include: { slot: { select: { slotNumber: true } } } },
    },
    orderBy: [{ bookingDate: 'desc' }, { createdAt: 'desc' }],
  });

  const grouped = new Map<string, AdminBookingRow[]>();
  for (const row of rows) {
    grouped.set(groupKey(row), [...(grouped.get(groupKey(row)) ?? []), row]);
  }

  const bookingGroups = [...grouped.values()]
    .map((history) => {
      const current = currentHistoryRow(history);
      return {
        ...current,
        history: [...history].sort((a, b) => rowTime(a) - rowTime(b)),
      };
    })
    .sort((a, b) => {
      const date = b.bookingDate.getTime() - a.bookingDate.getTime();
      if (date !== 0) return date;
      return rowTime(b) - rowTime(a);
    });

  return { rows: bookingGroups.slice(page.skip, page.skip + page.take), total: bookingGroups.length };
}
