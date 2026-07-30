import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { getString, getNumber } from '../../config/systemConfig';
import { ValidationError, ConflictError, NotFoundError, WindowClosedError } from '../../lib/errors';
import {
  isValidCalendarDate,
  isBookableWeekday,
  isBeforePrimaryCutoff,
  parseCalendarDate,
} from './bookings.time';
import type { PageArgs } from '../../lib/pagination';
import type { CreateBookingInput, ListBookingsQuery } from './bookings.schema';

const DEFAULT_PRIMARY_CUTOFF = '18:00';
const DEFAULT_MAX_PEOPLE = 4;

/** Authenticated principal (matches req.user). */
export interface Principal {
  id: string;
  role: 'SUPER_ADMIN' | 'COMPANY_ADMIN' | 'USER';
  companyId: string;
}

const fail = (field: string, message: string): never => {
  throw new ValidationError('Request validation failed', [{ field, message }]);
};

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

  const [rows, total] = await Promise.all([
    prisma.bookingRequest.findMany({
      where,
      include: {
        user: { select: { fullName: true, email: true } },
        company: { select: { name: true } },
        allocation: { include: { slot: { select: { slotNumber: true } } } },
      },
      orderBy: [{ bookingDate: 'desc' }, { createdAt: 'desc' }],
      skip: page.skip,
      take: page.take,
    }),
    prisma.bookingRequest.count({ where }),
  ]);
  return { rows, total };
}
