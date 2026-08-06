import type { BookingStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { normalizePlate } from '../../lib/plate';
import type { PageArgs } from '../../lib/pagination';
import type { CreateMyVehicleInput, UpdateMyVehicleInput, UpdateProfileInput } from './me.schema';

const userInclude = { roles: { include: { role: true } }, company: true } as const;

/** Load the current user's profile (with roles + company for `toUserProfile`). */
export async function getProfile(userId: string) {
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null }, include: userInclude });
  if (!user) throw new NotFoundError('User not found');
  return user;
}

/** Partial self-update (name/contact/address/PIN/distance). Distance feeds future booking scores (F6). */
export async function updateProfile(userId: string, input: UpdateProfileInput) {
  await getProfile(userId); // 404 if the user is gone
  await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
      ...(input.contactNumber !== undefined ? { contactNumber: input.contactNumber } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.pinCode !== undefined ? { pinCode: input.pinCode } : {}),
      ...(input.distanceKm !== undefined ? { distanceKm: input.distanceKm } : {}),
    },
  });
  return getProfile(userId);
}

/** Cars saved by the current user. Active rows are visible to the security vehicle registry. */
export async function listMyVehicles(userId: string) {
  return prisma.vehicle.findMany({
    where: { userId, isActive: true },
    include: { company: { select: { name: true } } },
    orderBy: [{ createdAt: 'desc' }],
  });
}

const vehicleInclude = { company: { select: { name: true } } } as const;

type VehicleOwner = Awaited<ReturnType<typeof getProfile>>;

/**
 * The registry row already holding `vehicleNumber`, if this user is allowed to take it over.
 *
 * `Vehicle.vehicleNumber` is globally unique and NOT scoped by `isActive` or owner, so claiming a
 * plate is the one operation that can collide with another tenant. A row is claimable when it is
 * already this user's, or when it is an unlinked import row carrying their email (that is how the
 * Excel-imported registry gets adopted). Returns null when the plate is free.
 */
async function claimablePlateRow(user: VehicleOwner, vehicleNumber: string, exceptVehicleId?: string) {
  const existing = await prisma.vehicle.findUnique({ where: { vehicleNumber } });
  if (!existing || existing.id === exceptVehicleId) return null;
  const ownerEmailMatches = existing.ownerEmail?.toLowerCase() === user.email.toLowerCase();
  if ((existing.userId && existing.userId !== user.id) || (!existing.userId && !ownerEmailMatches)) {
    throw new ConflictError('This car number is already registered in the vehicle registry');
  }
  return existing;
}

/** Owner/company columns the registry mirrors from the profile, refreshed on every write. */
function ownerFields(user: VehicleOwner) {
  return {
    ownerName: user.fullName,
    ownerEmail: user.email,
    contactNumber: user.contactNumber,
    companyId: user.companyId,
    userId: user.id,
  };
}

/** Add or reactivate one of the current user's cars in the building-wide vehicle registry. */
export async function createMyVehicle(userId: string, input: CreateMyVehicleInput) {
  const user = await getProfile(userId);
  const vehicleNumber = normalizePlate(input.vehicleNumber);
  const existing = await claimablePlateRow(user, vehicleNumber);

  const data = {
    displayNumber: input.displayNumber?.trim() || input.vehicleNumber.trim().toUpperCase(),
    ...ownerFields(user),
    vehicleType: input.vehicleType ?? 'CAR',
    makeModel: input.makeModel ?? null,
    colour: input.colour ?? null,
    notes: input.notes ?? null,
    isActive: true,
  };

  if (existing) {
    return prisma.vehicle.update({ where: { id: existing.id }, data, include: vehicleInclude });
  }

  return prisma.vehicle.create({ data: { vehicleNumber, ...data }, include: vehicleInclude });
}

/**
 * Edit one of the current user's saved cars, including its number.
 *
 * PATCH semantics: only the supplied fields move. Changing the plate goes through the same
 * claimability guard as `createMyVehicle`, so the 409 story is identical however the plate is set.
 */
export async function updateMyVehicle(userId: string, vehicleId: string, input: UpdateMyVehicleInput) {
  const user = await getProfile(userId);
  const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, userId, isActive: true } });
  if (!vehicle) throw new NotFoundError('Car not found');

  const plateChanged = input.vehicleNumber !== undefined && normalizePlate(input.vehicleNumber) !== vehicle.vehicleNumber;
  const nextPlate = plateChanged ? normalizePlate(input.vehicleNumber!) : vehicle.vehicleNumber;

  const data = {
    ...ownerFields(user),
    // A renamed plate whose display form was not given must not keep advertising the old number.
    ...(input.displayNumber !== undefined
      ? { displayNumber: input.displayNumber.trim() }
      : plateChanged
        ? { displayNumber: input.vehicleNumber!.trim().toUpperCase() }
        : {}),
    ...(input.vehicleType !== undefined ? { vehicleType: input.vehicleType } : {}),
    ...(input.makeModel !== undefined ? { makeModel: input.makeModel } : {}),
    ...(input.colour !== undefined ? { colour: input.colour } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    isActive: true,
  };

  if (plateChanged) {
    const other = await claimablePlateRow(user, nextPlate, vehicle.id);
    if (other) {
      // The target plate already has a row this user may claim (typically one they removed earlier).
      // Merge into it rather than renaming: `vehicleNumber` is globally unique, and GateEvent rows
      // reference vehicles by id, so deleting the old row to free the plate would orphan visit history.
      await prisma.vehicle.update({ where: { id: vehicle.id }, data: { isActive: false } });
      return prisma.vehicle.update({ where: { id: other.id }, data, include: vehicleInclude });
    }
  }

  return prisma.vehicle.update({
    where: { id: vehicle.id },
    data: plateChanged ? { ...data, vehicleNumber: nextPlate } : data,
    include: vehicleInclude,
  });
}

/**
 * Best-effort: make sure a plate typed straight into the booking form also exists in the registry.
 *
 * Without this, a booking made with a car the user never saved to their profile is invisible to the
 * gate's typeahead — the guard has to know and type the exact plate, and even then the console shows
 * "Not in the vehicle registry" with no driver or slot. Registering it turns the booking into a
 * normal recognised arrival.
 *
 * Deliberately swallowing failures: this is a side-effect of booking, not part of its contract. The
 * realistic failure is a 409 when the plate belongs to somebody else — a car shared between two
 * colleagues, say — and refusing the booking over that would be absurd. The booking keeps its own
 * `vehicleNumber` snapshot either way, and the gate's plate fallback still matches it.
 */
export async function ensureVehicleOnProfile(
  userId: string,
  vehicleNumber: string,
  vehicleType?: 'CAR' | 'EV_CAR' | 'BIKE',
): Promise<{ registered: boolean; reason?: string }> {
  if (normalizePlate(vehicleNumber).length < 4) return { registered: false, reason: 'plate too short' };
  try {
    await createMyVehicle(userId, { vehicleNumber, vehicleType });
    return { registered: true };
  } catch (err) {
    return { registered: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/** Remove a saved car from the active registry without breaking historical gate events. */
export async function removeMyVehicle(userId: string, vehicleId: string) {
  const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, userId, isActive: true } });
  if (!vehicle) throw new NotFoundError('Car not found');
  return prisma.vehicle.update({ where: { id: vehicle.id }, data: { isActive: false } });
}

/** List the current user's own bookings, newest first (paged), optionally filtered by status. */
export async function listMyBookings(userId: string, opts: { status?: BookingStatus } & PageArgs) {
  const where = { userId, ...(opts.status ? { status: opts.status } : {}) };
  const [rows, total] = await Promise.all([
    prisma.bookingRequest.findMany({
      where,
      include: { allocation: { include: { slot: { select: { slotNumber: true } } } } },
      orderBy: [{ bookingDate: 'desc' }, { createdAt: 'desc' }],
      skip: opts.skip,
      take: opts.take,
    }),
    prisma.bookingRequest.count({ where }),
  ]);
  return { rows, total };
}
