import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { isUniqueViolation } from '../../lib/prismaErrors';
import { normalizePlate } from '../../lib/plate';
import { buildAuditData } from '../../lib/audit';
import { currentIstCalendarDate, isValidCalendarDate, parseCalendarDate } from '../bookings/bookings.time';
import { LIVE_BOOKING_STATUSES } from '../bookings/bookings.availability';
import type { PageArgs } from '../../lib/pagination';
import type { Role } from '../../lib/roles';

/**
 * Gate service (Phase 7 §5) — the security persona's whole job: look a car number up, stamp a
 * check-in, stamp a check-out.
 *
 * Guiding rule is D16: **never block the barrier.** An unknown plate, or a known one with no booking
 * for today, still gets recorded — flagged `hadBooking = false` so the company admin can follow up.
 * The gate is not tenant-scoped (D15): one guard serves every company in the building.
 */

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Typeahead over the registry — what the drawer's car-number field queries as the guard types. */
export async function searchVehicles(search: string, limit = 10) {
  const normalized = normalizePlate(search);
  if (!normalized) return [];
  return prisma.vehicle.findMany({
    where: {
      isActive: true,
      OR: [
        { vehicleNumber: { contains: normalized } },
        { ownerName: { contains: search, mode: 'insensitive' } },
      ],
    },
    include: { company: { select: { name: true } } },
    orderBy: { vehicleNumber: 'asc' },
    take: Math.min(limit, 25),
  });
}

export interface GateLookup {
  vehicleNumber: string;
  known: boolean;
  vehicle: {
    id: string;
    displayNumber: string;
    ownerName: string;
    ownerEmail: string | null;
    contactNumber: string | null;
    vehicleType: string;
    makeModel: string | null;
    colour: string | null;
    companyId: string | null;
    companyName: string | null;
    userId: string | null;
  } | null;
  bookingDate: string;
  hasBooking: boolean;
  booking: {
    id: string;
    status: string;
    bookingType: string;
    allocatedSlotNumber: string | null;
  } | null;
  /** The still-open visit for today, if the car is already inside. */
  openVisit: { id: string; checkInAt: string } | null;
}

/**
 * Resolve everything the drawer needs from a car number alone: who owns it, whether they have a
 * booking for today, and whether they are already inside. Never throws for an unknown plate — an
 * unknown car is a normal, recordable case (D16).
 */
export async function lookupVehicle(rawNumber: string, now: Date = new Date()): Promise<GateLookup> {
  const vehicleNumber = normalizePlate(rawNumber);
  if (!vehicleNumber) {
    throw new ValidationError('Request validation failed', [
      { field: 'number', message: 'Enter a car number' },
    ]);
  }
  const bookingDate = currentIstCalendarDate(now);

  const [vehicle, openVisit] = await Promise.all([
    prisma.vehicle.findUnique({
      where: { vehicleNumber },
      include: { company: { select: { name: true } } },
    }),
    prisma.gateEvent.findFirst({
      where: { vehicleNumber, bookingDate, status: 'CHECKED_IN' },
      orderBy: { checkInAt: 'desc' },
      select: { id: true, checkInAt: true },
    }),
  ]);

  const booking = await findTodaysBooking(vehicleNumber, vehicle?.userId ?? null, bookingDate);

  return {
    vehicleNumber,
    known: vehicle !== null,
    vehicle: vehicle
      ? {
          id: vehicle.id,
          displayNumber: vehicle.displayNumber,
          ownerName: vehicle.ownerName,
          ownerEmail: vehicle.ownerEmail,
          contactNumber: vehicle.contactNumber,
          vehicleType: vehicle.vehicleType,
          makeModel: vehicle.makeModel,
          colour: vehicle.colour,
          companyId: vehicle.companyId,
          companyName: vehicle.company?.name ?? null,
          userId: vehicle.userId,
        }
      : null,
    bookingDate: isoDate(bookingDate),
    hasBooking: booking !== null,
    booking: booking
      ? {
          id: booking.id,
          status: booking.status,
          bookingType: booking.bookingType,
          allocatedSlotNumber: booking.allocation?.slot?.slotNumber ?? null,
        }
      : null,
    openVisit: openVisit ? { id: openVisit.id, checkInAt: openVisit.checkInAt.toISOString() } : null,
  };
}

/**
 * Today's booking for this car. Matched on the registered owner first (the reliable link), falling
 * back to the plate typed onto the booking itself — a user may drive a car that is not theirs, or one
 * the registry does not know yet.
 */
async function findTodaysBooking(vehicleNumber: string, userId: string | null, bookingDate: Date) {
  const include = { allocation: { include: { slot: { select: { slotNumber: true } } } } } as const;
  const base = { bookingDate, status: { in: LIVE_BOOKING_STATUSES } };

  if (userId) {
    // A user can hold one PRIMARY and one COMMON_POOL row for a date; the ALLOCATED one is the
    // meaningful answer at the gate (enum sort order would not put it first, so pick explicitly).
    const byOwner = await prisma.bookingRequest.findMany({ where: { ...base, userId }, include });
    const best = byOwner.find((b) => b.status === 'ALLOCATED') ?? byOwner[0];
    if (best) return best;
  }

  // Plate as typed on the booking: compare normalized, since users type it freely.
  const sameDate = await prisma.bookingRequest.findMany({
    where: { ...base, vehicleNumber: { not: null } },
    include,
  });
  return sameDate.find((b) => b.vehicleNumber && normalizePlate(b.vehicleNumber) === vehicleNumber) ?? null;
}

export interface CheckInInput {
  vehicleNumber: string;
  notes?: string | null;
}

/**
 * Stamp a check-in. Records the visit whatever the booking situation is (D16) and reports back
 * `hadBooking` so the UI can warn the guard and the company admin can see the entry.
 *
 * Rejects only a genuine double check-in (the car is already inside and has not left) — that is a
 * data-integrity problem, not a policy decision, and the partial unique index enforces it under
 * concurrency.
 */
export async function checkIn(securityUserId: string, input: CheckInInput, now: Date = new Date()) {
  const lookup = await lookupVehicle(input.vehicleNumber, now);
  if (lookup.openVisit) {
    throw new ConflictError(
      `${lookup.vehicleNumber} is already checked in (since ${lookup.openVisit.checkInAt}) — check it out first`,
    );
  }
  const bookingDate = parseCalendarDate(lookup.bookingDate);

  try {
    return await prisma.$transaction(async (tx) => {
      const event = await tx.gateEvent.create({
        data: {
          vehicleNumber: lookup.vehicleNumber,
          vehicleId: lookup.vehicle?.id ?? null,
          userId: lookup.vehicle?.userId ?? null,
          companyId: lookup.vehicle?.companyId ?? null,
          bookingRequestId: lookup.booking?.id ?? null,
          bookingDate,
          hadBooking: lookup.hasBooking,
          status: 'CHECKED_IN',
          ownerNameSnapshot: lookup.vehicle?.ownerName ?? null,
          checkInAt: now,
          checkedInById: securityUserId,
          notes: input.notes ?? null,
        },
        include: { company: { select: { name: true } } },
      });
      await tx.auditLog.create({
        data: buildAuditData({
          actionType: 'GATE_CHECK_IN',
          entityType: 'GateEvent',
          entityId: event.id,
          newValue: {
            vehicleNumber: lookup.vehicleNumber,
            known: lookup.known,
            hadBooking: lookup.hasBooking,
            bookingId: lookup.booking?.id ?? null,
            bookingDate: lookup.bookingDate,
          },
        }),
      });
      return event;
    });
  } catch (err) {
    // The partial unique index caught a concurrent second check-in for the same car and day.
    if (isUniqueViolation(err)) {
      throw new ConflictError(`${lookup.vehicleNumber} is already checked in — check it out first`);
    }
    throw err;
  }
}

/** Close the open visit for a car. 404 when it is not currently inside. */
export async function checkOut(
  securityUserId: string,
  input: { vehicleNumber: string; notes?: string | null },
  now: Date = new Date(),
) {
  const vehicleNumber = normalizePlate(input.vehicleNumber);
  if (!vehicleNumber) {
    throw new ValidationError('Request validation failed', [
      { field: 'vehicleNumber', message: 'Enter a car number' },
    ]);
  }
  const bookingDate = currentIstCalendarDate(now);

  // A car that came in before midnight IST and leaves after it still has an open visit on the
  // previous business date — look for the latest open visit rather than only today's.
  const open = await prisma.gateEvent.findFirst({
    where: { vehicleNumber, status: 'CHECKED_IN' },
    orderBy: { checkInAt: 'desc' },
  });
  if (!open) {
    throw new NotFoundError(`${vehicleNumber} is not currently checked in`);
  }

  return prisma.$transaction(async (tx) => {
    const event = await tx.gateEvent.update({
      where: { id: open.id },
      data: {
        status: 'CHECKED_OUT',
        checkOutAt: now,
        checkedOutById: securityUserId,
        ...(input.notes ? { notes: input.notes } : {}),
      },
      include: { company: { select: { name: true } } },
    });
    await tx.auditLog.create({
      data: buildAuditData({
        actionType: 'GATE_CHECK_OUT',
        entityType: 'GateEvent',
        entityId: event.id,
        oldValue: { status: 'CHECKED_IN', checkInAt: open.checkInAt.toISOString() },
        newValue: {
          status: 'CHECKED_OUT',
          checkOutAt: now.toISOString(),
          bookingDate: isoDate(open.bookingDate),
          onSameBusinessDate: isoDate(open.bookingDate) === isoDate(bookingDate),
        },
      }),
    });
    return event;
  });
}

/** Gate log for a date (defaults to today, IST). SECURITY and SUPER_ADMIN see the whole building. */
export async function listGateEvents(
  filter: { date?: string; status?: 'CHECKED_IN' | 'CHECKED_OUT'; hadBooking?: boolean },
  page: PageArgs,
  now: Date = new Date(),
) {
  const where = buildEventWhere(filter, now);
  const [rows, total] = await Promise.all([
    prisma.gateEvent.findMany({
      where,
      include: { company: { select: { name: true } }, vehicle: { select: { displayNumber: true } } },
      orderBy: { checkInAt: 'desc' },
      skip: page.skip,
      take: page.take,
    }),
    prisma.gateEvent.count({ where }),
  ]);
  return { rows, total };
}

/**
 * Entries with no booking (D16) — the company-admin dashboard feed. COMPANY_ADMIN is forced to their
 * own company; SUPER_ADMIN sees every company and may narrow with `companyId`.
 *
 * Note: an unknown plate has no `companyId`, so it can only ever appear for the SUPER_ADMIN. That is
 * intentional — nobody can attribute an unregistered car to a tenant.
 */
export async function listUnbookedEntries(
  principal: { role: Role; companyId: string },
  filter: { date?: string; companyId?: string },
  page: PageArgs,
  now: Date = new Date(),
) {
  // Allow-listed: only SUPER_ADMIN sees the building-wide feed (and may narrow to one company).
  const scope: Prisma.GateEventWhereInput =
    principal.role === 'SUPER_ADMIN'
      ? filter.companyId
        ? { companyId: filter.companyId }
        : {}
      : { companyId: principal.companyId };
  const where: Prisma.GateEventWhereInput = {
    ...buildEventWhere({ date: filter.date, hadBooking: false }, now),
    ...scope,
  };
  const [rows, total] = await Promise.all([
    prisma.gateEvent.findMany({
      where,
      include: { company: { select: { name: true } }, vehicle: { select: { displayNumber: true } } },
      orderBy: { checkInAt: 'desc' },
      skip: page.skip,
      take: page.take,
    }),
    prisma.gateEvent.count({ where }),
  ]);
  return { rows, total };
}

/** Count of today's unbooked entries — the dashboard stat tile. */
export function countUnbookedEntries(
  principal: { role: Role; companyId: string },
  now: Date = new Date(),
): Promise<number> {
  return prisma.gateEvent.count({
    where: {
      bookingDate: currentIstCalendarDate(now),
      hadBooking: false,
      ...(principal.role === 'SUPER_ADMIN' ? {} : { companyId: principal.companyId }),
    },
  });
}

function buildEventWhere(
  filter: { date?: string; status?: 'CHECKED_IN' | 'CHECKED_OUT'; hadBooking?: boolean },
  now: Date,
): Prisma.GateEventWhereInput {
  if (filter.date && !isValidCalendarDate(filter.date)) {
    throw new ValidationError('Request validation failed', [
      { field: 'date', message: 'Not a valid calendar date' },
    ]);
  }
  return {
    bookingDate: filter.date ? parseCalendarDate(filter.date) : currentIstCalendarDate(now),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.hadBooking !== undefined ? { hadBooking: filter.hadBooking } : {}),
  };
}
