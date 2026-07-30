import type { BookingStatus } from '@prisma/client';
import { asyncHandler } from '../../lib/asyncHandler';
import { sendSuccess } from '../../lib/response';
import { UnauthenticatedError } from '../../lib/errors';
import { parsePagination } from '../../lib/pagination';
import { toUserProfile } from '../../lib/dto';
import * as service from './me.service';

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: unknown) => (v != null ? Number(v) : null);

type BookingRow = Awaited<ReturnType<typeof service.listMyBookings>>['rows'][number];

/** openapi Booking (list summary). */
function toBooking(b: BookingRow) {
  return {
    id: b.id,
    bookingDate: isoDate(b.bookingDate),
    bookingType: b.bookingType,
    status: b.status,
    travelDistanceKm: num(b.travelDistanceKm),
    vehicleType: b.vehicleType ?? null,
    vehicleNumber: b.vehicleNumber ?? null,
    carpoolMemberCount: b.carpoolMemberCount,
    specialRequirement: b.specialRequirement ?? null,
    allocationScore: num(b.allocationScore),
    allocatedSlotNumber: b.allocation?.slot?.slotNumber ?? null,
    createdAt: b.createdAt.toISOString(),
  };
}

export const getMe = asyncHandler(async (req, res) => {
  if (!req.user) throw new UnauthenticatedError();
  sendSuccess(res, toUserProfile(await service.getProfile(req.user.id)));
});

export const updateMe = asyncHandler(async (req, res) => {
  if (!req.user) throw new UnauthenticatedError();
  sendSuccess(res, toUserProfile(await service.updateProfile(req.user.id, req.body)));
});

export const getMyBookings = asyncHandler(async (req, res) => {
  if (!req.user) throw new UnauthenticatedError();
  const p = parsePagination(req.query as Record<string, unknown>);
  const { rows, total } = await service.listMyBookings(req.user.id, {
    status: req.query.status as BookingStatus | undefined,
    ...p,
  });
  sendSuccess(res, rows.map(toBooking), 200, { page: p.page, pageSize: p.pageSize, total });
});
