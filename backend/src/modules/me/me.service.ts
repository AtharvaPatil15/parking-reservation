import type { BookingStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { normalizePlate } from '../../lib/plate';
import type { PageArgs } from '../../lib/pagination';
import type { CreateMyVehicleInput, UpdateProfileInput } from './me.schema';

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

/** Add or reactivate one of the current user's cars in the building-wide vehicle registry. */
export async function createMyVehicle(userId: string, input: CreateMyVehicleInput) {
  const user = await getProfile(userId);
  const vehicleNumber = normalizePlate(input.vehicleNumber);
  const existing = await prisma.vehicle.findUnique({ where: { vehicleNumber } });
  if (existing && existing.userId && existing.userId !== userId) {
    throw new ConflictError('This car number is already registered to another user');
  }

  const data = {
    displayNumber: input.displayNumber?.trim() || input.vehicleNumber.trim().toUpperCase(),
    ownerName: user.fullName,
    ownerEmail: user.email,
    contactNumber: user.contactNumber,
    companyId: user.companyId,
    userId,
    vehicleType: input.vehicleType ?? 'CAR',
    makeModel: input.makeModel ?? null,
    colour: input.colour ?? null,
    notes: input.notes ?? null,
    isActive: true,
  };

  if (existing) {
    return prisma.vehicle.update({
      where: { id: existing.id },
      data,
      include: { company: { select: { name: true } } },
    });
  }

  return prisma.vehicle.create({
    data: { vehicleNumber, ...data },
    include: { company: { select: { name: true } } },
  });
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
