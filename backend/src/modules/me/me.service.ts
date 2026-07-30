import type { BookingStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { NotFoundError } from '../../lib/errors';
import type { PageArgs } from '../../lib/pagination';
import type { UpdateProfileInput } from './me.schema';

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
