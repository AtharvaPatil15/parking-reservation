import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors';
import { isUniqueViolation } from '../../lib/prismaErrors';
import { normalizePlate } from '../../lib/plate';
import { buildAuditData } from '../../lib/audit';
import { currentIstCalendarDate, isValidCalendarDate, parseCalendarDate } from '../bookings/bookings.time';
import { LIVE_BOOKING_STATUSES } from '../bookings/bookings.availability';
import { countInServiceSlots, getEffectiveQuota } from '../slots/slots.service';
import type { PageArgs } from '../../lib/pagination';
import type { Role } from '../../lib/roles';
import type { CreateRegistrationInput, RegistrationDecisionInput } from './gate.schema';

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
    /**
     * Who the booking belongs to. Independent of `vehicle`: when the plate is not in the registry
     * these are the only identity the gate has, so they are populated either way.
     */
    employeeName: string | null;
    contactNumber: string | null;
    companyId: string | null;
    companyName: string | null;
    userId: string | null;
  } | null;
  /** The still-open visit for today, if the car is already inside. */
  openVisit: { id: string; checkInAt: string } | null;
  /**
   * An outstanding walk-in registration for this plate. While one exists the car is **not** admitted —
   * surfaced here so the drawer can say who has to approve it instead of just greying out the button.
   */
  pendingRegistration: {
    id: string;
    ownerName: string;
    companyId: string;
    companyName: string;
    requestedAt: string;
  } | null;
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

  const [vehicle, openVisit, pending] = await Promise.all([
    prisma.vehicle.findFirst({
      where: { vehicleNumber, isActive: true },
      include: { company: { select: { name: true } } },
    }),
    prisma.gateEvent.findFirst({
      where: { vehicleNumber, bookingDate, status: 'CHECKED_IN' },
      orderBy: { checkInAt: 'desc' },
      select: { id: true, checkInAt: true },
    }),
    prisma.vehicleRegistrationRequest.findFirst({
      where: { vehicleNumber, status: 'PENDING' },
      include: registrationInclude,
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
          // Who the booking belongs to. For an unregistered plate this is the only identity available,
          // so the console can name the driver instead of just saying the car is unknown.
          employeeName: booking.user?.fullName ?? null,
          contactNumber: booking.user?.contactNumber ?? null,
          companyId: booking.company?.id ?? null,
          companyName: booking.company?.name ?? null,
          userId: booking.user?.id ?? null,
        }
      : null,
    openVisit: openVisit ? { id: openVisit.id, checkInAt: openVisit.checkInAt.toISOString() } : null,
    pendingRegistration: pending
      ? {
          id: pending.id,
          ownerName: pending.ownerName,
          companyId: pending.companyId,
          companyName: pending.company.name,
          requestedAt: pending.createdAt.toISOString(),
        }
      : null,
  };
}

/**
 * Today's booking for this car. Matched on the registered owner first (the reliable link), falling
 * back to the plate typed onto the booking itself — a user may drive a car that is not theirs, or one
 * the registry does not know yet.
 */
async function findTodaysBooking(vehicleNumber: string, userId: string | null, bookingDate: Date) {
  // The booker's identity matters on its own, not just the slot: when the plate is NOT in the registry
  // this booking is the only thing that can tell the guard who is at the barrier.
  const include = {
    allocation: { include: { slot: { select: { slotNumber: true } } } },
    user: { select: { id: true, fullName: true, contactNumber: true } },
    company: { select: { id: true, name: true } },
  } as const;
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
  /**
   * A car with an outstanding walk-in registration waits (Prithviraj, 2026-08-05: "once approved let
   * them in"). This is the one place the gate refuses a car, and it is a narrow exception to D16 rather
   * than a retreat from it: the plate is only in this state because a guard chose to register it, i.e.
   * declared it a new employee rather than a visitor. An unrecognised plate nobody registered is still
   * recorded and admitted, exactly as before.
   */
  if (lookup.pendingRegistration) {
    throw new ConflictError(
      `${lookup.vehicleNumber} is waiting for ${lookup.pendingRegistration.companyName} to approve its registration — call them, then check in once it shows as approved`,
    );
  }
  const bookingDate = parseCalendarDate(lookup.bookingDate);

  try {
    return await prisma.$transaction(async (tx) => {
      const event = await tx.gateEvent.create({
        data: {
          vehicleNumber: lookup.vehicleNumber,
          vehicleId: lookup.vehicle?.id ?? null,
          // Registry first, then the matched booking. Taking these from the vehicle alone meant an
          // unregistered plate recorded companyId: null even when its booking said exactly whose it
          // was — so the visit never reached that company's gate log and only SUPER_ADMIN could see it.
          userId: lookup.vehicle?.userId ?? lookup.booking?.userId ?? null,
          companyId: lookup.vehicle?.companyId ?? lookup.booking?.companyId ?? null,
          bookingRequestId: lookup.booking?.id ?? null,
          bookingDate,
          hadBooking: lookup.hasBooking,
          status: 'CHECKED_IN',
          ownerNameSnapshot: lookup.vehicle?.ownerName ?? lookup.booking?.employeeName ?? null,
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

// ---- Walk-in vehicle registration (2026-08-05) ------------------------------

const registrationInclude = { company: { select: { name: true } } } as const;

/**
 * Register a walk-in car — the guard met a new employee at the barrier whose car nobody had added.
 *
 * Creates a **request**, not a Vehicle: the named company's admin (or the Super Admin) decides. Until
 * they do, `checkIn` refuses the plate, so "once approved, let them in" is enforced by the gate rather
 * than left to the guard to remember.
 */
export async function createRegistration(
  securityUserId: string,
  input: CreateRegistrationInput,
): Promise<unknown> {
  const vehicleNumber = normalizePlate(input.vehicleNumber);
  if (!vehicleNumber) {
    throw new ValidationError('Request validation failed', [
      { field: 'vehicleNumber', message: 'Enter a car number' },
    ]);
  }

  const company = await prisma.company.findFirst({
    where: { id: input.companyId, deletedAt: null, status: 'ACTIVE' },
    select: { id: true, name: true },
  });
  if (!company) {
    throw new ValidationError('Request validation failed', [
      { field: 'companyId', message: 'Company not found or not active' },
    ]);
  }

  // Already in the registry — there is nothing to approve, and the guard should just check them in.
  const existing = await prisma.vehicle.findFirst({ where: { vehicleNumber, isActive: true } });
  if (existing) {
    throw new ConflictError(`${vehicleNumber} is already registered — check it in as normal`);
  }
  const pending = await prisma.vehicleRegistrationRequest.findFirst({
    where: { vehicleNumber, status: 'PENDING' },
    include: registrationInclude,
  });
  if (pending) {
    throw new ConflictError(
      `${vehicleNumber} is already waiting for approval from ${pending.company.name}`,
    );
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.vehicleRegistrationRequest.create({
        data: {
          vehicleNumber,
          displayNumber: input.displayNumber?.trim() || input.vehicleNumber.trim().toUpperCase(),
          ownerName: input.ownerName,
          ownerEmail: input.ownerEmail ?? null,
          contactNumber: input.contactNumber ?? null,
          companyId: company.id,
          vehicleType: input.vehicleType ?? 'CAR',
          makeModel: input.makeModel ?? null,
          colour: input.colour ?? null,
          notes: input.notes ?? null,
          requestedById: securityUserId,
        },
        include: registrationInclude,
      });
      await tx.auditLog.create({
        data: buildAuditData({
          actionType: 'VEHICLE_REGISTRATION_REQUESTED',
          entityType: 'VehicleRegistrationRequest',
          entityId: created.id,
          newValue: {
            vehicleNumber,
            ownerName: created.ownerName,
            companyId: company.id,
            requestedById: securityUserId,
          },
        }),
      });
      return created;
    });
  } catch (err) {
    // The partial unique index caught a concurrent duplicate for the same plate.
    if (isUniqueViolation(err)) {
      throw new ConflictError(`${vehicleNumber} is already waiting for approval`);
    }
    throw err;
  }
}

/**
 * List registration requests, scoped by who is asking:
 *  - COMPANY_ADMIN → their own company's, and only theirs. Approving is a tenant decision.
 *  - SUPER_ADMIN   → every company's, narrowable with `companyId`.
 *  - SECURITY      → the ones **they** submitted, whatever the company. The guard has to know when a
 *    request has been approved, otherwise "once approved let them in" leaves them phoning the admin
 *    back to ask. Scoped to their own submissions, not the whole building's queue.
 */
export async function listRegistrations(
  principal: { id: string; role: Role; companyId: string },
  filter: { status?: 'PENDING' | 'APPROVED' | 'REJECTED'; companyId?: string },
  page: PageArgs,
) {
  const scope =
    principal.role === 'SUPER_ADMIN'
      ? filter.companyId
        ? { companyId: filter.companyId }
        : {}
      : principal.role === 'COMPANY_ADMIN'
        ? { companyId: principal.companyId }
        : { requestedById: principal.id };

  const where = { ...scope, ...(filter.status ? { status: filter.status } : {}) };
  const [rows, total] = await Promise.all([
    prisma.vehicleRegistrationRequest.findMany({
      where,
      include: registrationInclude,
      // Pending first, then most recent: an admin opening this screen wants the decisions they owe.
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      skip: page.skip,
      take: page.take,
    }),
    prisma.vehicleRegistrationRequest.count({ where }),
  ]);
  return { rows, total };
}

/** Pending count for the approval-tab badge, scoped the same way as the list. */
export function countPendingRegistrations(principal: { role: Role; companyId: string }): Promise<number> {
  return prisma.vehicleRegistrationRequest.count({
    where: {
      status: 'PENDING',
      ...(principal.role === 'SUPER_ADMIN' ? {} : { companyId: principal.companyId }),
    },
  });
}

/**
 * Approve or reject a walk-in registration. Approving upserts the real `Vehicle`, which is what lets the
 * gate admit the car — the decision and its effect are one transaction, so an approved request can never
 * exist without the registry row it promised.
 *
 * `userId` is resolved by email against an ACTIVE user of that company, the same soft link the vehicle
 * import uses. Left null when there is no match: a new employee may have no account yet, and the gate
 * only needs the car to be known.
 */
export async function decideRegistration(
  actor: { id: string; role: Role; companyId: string },
  id: string,
  input: RegistrationDecisionInput,
) {
  const request = await prisma.vehicleRegistrationRequest.findUnique({
    where: { id },
    include: registrationInclude,
  });
  if (!request) throw new NotFoundError('Registration request not found');
  // A Company Admin may only decide their own company's requests — the same tenant rule as every other
  // admin action. Checked after the lookup so a wrong-tenant id is a 403, not a 404 that leaks nothing.
  if (actor.role !== 'SUPER_ADMIN' && request.companyId !== actor.companyId) {
    throw new ForbiddenError('This registration belongs to another company');
  }
  if (request.status !== 'PENDING') {
    throw new ValidationError(`This request was already ${request.status.toLowerCase()}`);
  }

  if (input.decision === 'REJECT') {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.vehicleRegistrationRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          decidedById: actor.id,
          decidedAt: new Date(),
          decisionNote: input.note ?? null,
        },
        include: registrationInclude,
      });
      await tx.auditLog.create({
        data: buildAuditData({
          actionType: 'VEHICLE_REGISTRATION_DECIDED',
          entityType: 'VehicleRegistrationRequest',
          entityId: id,
          oldValue: { status: 'PENDING' },
          newValue: { status: 'REJECTED', decidedById: actor.id, note: input.note ?? null },
        }),
      });
      return updated;
    });
  }

  const linkedUser = request.ownerEmail
    ? await prisma.user.findFirst({
        where: {
          email: request.ownerEmail,
          companyId: request.companyId,
          status: 'ACTIVE',
          deletedAt: null,
        },
        select: { id: true },
      })
    : null;

  return prisma.$transaction(async (tx) => {
    const vehicleData = {
      displayNumber: request.displayNumber,
      ownerName: request.ownerName,
      ownerEmail: request.ownerEmail,
      contactNumber: request.contactNumber,
      companyId: request.companyId,
      userId: linkedUser?.id ?? null,
      vehicleType: request.vehicleType,
      makeModel: request.makeModel,
      colour: request.colour,
      notes: request.notes,
      isActive: true,
    };
    // Upsert, not create: the plate may exist as a deactivated row from an earlier stint, and a plain
    // create would hit the unique constraint on a car that is legitimately being re-registered.
    const vehicle = await tx.vehicle.upsert({
      where: { vehicleNumber: request.vehicleNumber },
      update: vehicleData,
      create: { vehicleNumber: request.vehicleNumber, ...vehicleData },
    });
    const updated = await tx.vehicleRegistrationRequest.update({
      where: { id },
      data: {
        status: 'APPROVED',
        decidedById: actor.id,
        decidedAt: new Date(),
        decisionNote: input.note ?? null,
        vehicleId: vehicle.id,
      },
      include: registrationInclude,
    });
    await tx.auditLog.create({
      data: buildAuditData({
        actionType: 'VEHICLE_REGISTRATION_DECIDED',
        entityType: 'VehicleRegistrationRequest',
        entityId: id,
        oldValue: { status: 'PENDING' },
        newValue: {
          status: 'APPROVED',
          decidedById: actor.id,
          vehicleId: vehicle.id,
          linkedUserId: linkedUser?.id ?? null,
          note: input.note ?? null,
        },
      }),
    });
    return updated;
  });
}

export interface CompanyCapacityRow {
  companyId: string;
  companyName: string;
  /** Slots the company holds for this date (effective-dated quota). */
  slots: number;
  /** Quota withdrawn for the date — without this the row does not add up and looks like a bug. */
  blocked: number;
  /** Every booking request for the date, whatever the outcome: the demand. */
  requests: number;
  /** Requests that won a slot — primary + common pool. */
  allocated: number;
  /** `slots - blocked - allocated`, floored at 0. What is still unclaimed. */
  free: number;
  /** Cars currently inside, from the gate log. Answers "are those allocated slots actually occupied?" */
  inside: number;
}

/**
 * Per-company capacity for a date — the gate's "is there room?" panel (2026-08-05).
 *
 * Built for the guard, not for a dashboard. Since a walk-in registration now waits for an admin's
 * approval, the guard needs to know *before* they pick up the phone whether that company has anything
 * left; and `allocated` vs `inside` tells them how many of today's slot-holders are still expected.
 *
 * Building-wide by design (D15): the gate serves every tenant, so it reads every tenant's numbers. That
 * is the same scope the guard already has over the gate log.
 *
 * `free` is quota-relative, NOT `slots - inside`: an allocated slot whose owner has not arrived yet is
 * taken, not free. A guard who admitted a car into it would be double-booking somebody's reservation.
 */
export async function getGateCapacity(dateStr: string | undefined, now: Date = new Date()) {
  if (dateStr && !isValidCalendarDate(dateStr)) {
    throw new ValidationError('Request validation failed', [
      { field: 'date', message: 'Not a valid calendar date' },
    ]);
  }
  const date = dateStr ? parseCalendarDate(dateStr) : currentIstCalendarDate(now);

  const [companies, totalSlots, allocations, requests, blocks, insideRows] = await Promise.all([
    prisma.company.findMany({
      where: { status: 'ACTIVE', deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    countInServiceSlots(),
    prisma.parkingAllocation.groupBy({ by: ['companyId'], where: { bookingDate: date }, _count: { _all: true } }),
    prisma.bookingRequest.groupBy({ by: ['companyId'], where: { bookingDate: date }, _count: { _all: true } }),
    prisma.slotBlock.groupBy({
      by: ['companyId'],
      where: { startDate: { lte: date }, endDate: { gte: date } },
      _sum: { blockedCount: true },
    }),
    // Cars inside *now*, not "checked in on this date": a visit that began yesterday and has not been
    // checked out is still occupying a space. Only meaningful for today, which is the default.
    prisma.gateEvent.groupBy({ by: ['companyId'], where: { status: 'CHECKED_IN' }, _count: { _all: true } }),
  ]);

  const allocatedBy = new Map(allocations.map((a) => [a.companyId, a._count._all]));
  const requestsBy = new Map(requests.map((r) => [r.companyId, r._count._all]));
  const blockedBy = new Map(blocks.map((b) => [b.companyId, b._sum.blockedCount ?? 0]));
  const insideBy = new Map(insideRows.filter((g) => g.companyId).map((g) => [g.companyId!, g._count._all]));

  const rows: CompanyCapacityRow[] = await Promise.all(
    companies.map(async (c) => {
      const slots = await getEffectiveQuota(c.id, date);
      const blocked = blockedBy.get(c.id) ?? 0;
      const allocated = allocatedBy.get(c.id) ?? 0;
      return {
        companyId: c.id,
        companyName: c.name,
        slots,
        blocked,
        requests: requestsBy.get(c.id) ?? 0,
        allocated,
        free: Math.max(0, slots - blocked - allocated),
        inside: insideBy.get(c.id) ?? 0,
      };
    }),
  );

  const sum = (pick: (r: CompanyCapacityRow) => number) => rows.reduce((total, r) => total + pick(r), 0);
  // An unregistered car has no company, so its visit lands in no row above — counted here only, which is
  // why the building total can exceed the sum of the companies. Reported separately rather than hidden.
  const insideUnattributed = insideRows
    .filter((g) => !g.companyId)
    .reduce((total, g) => total + g._count._all, 0);

  return {
    bookingDate: isoDate(date),
    rows,
    building: {
      // The physical building, not the sum of quotas — those can be under-allotted, and a guard asking
      // "how big is this car park" means the former.
      totalSlots,
      allottedSlots: sum((r) => r.slots),
      blocked: sum((r) => r.blocked),
      requests: sum((r) => r.requests),
      allocated: sum((r) => r.allocated),
      free: sum((r) => r.free),
      inside: sum((r) => r.inside) + insideUnattributed,
      insideUnattributed,
    },
  };
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
