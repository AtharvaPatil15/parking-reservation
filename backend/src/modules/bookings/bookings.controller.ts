import { asyncHandler } from '../../lib/asyncHandler';
import { sendSuccess } from '../../lib/response';
import { parsePagination } from '../../lib/pagination';
import { UnauthenticatedError } from '../../lib/errors';
import * as service from './bookings.service';

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: unknown) => (v != null ? Number(v) : null);

type CreatedBooking = Awaited<ReturnType<typeof service.createBooking>>;
type BookingDetail = Awaited<ReturnType<typeof service.getBookingForPrincipal>>;
type AdminBookingRow = Awaited<ReturnType<typeof service.listBookings>>['rows'][number];
type AdminBookingHistoryRow = AdminBookingRow['history'][number];

/** openapi BookingCreatedData. `carpoolPeople` = driver + declared members. */
function toBookingCreated(b: CreatedBooking) {
  return {
    id: b.id,
    status: b.status,
    bookingType: b.bookingType,
    bookingDate: isoDate(b.bookingDate),
    travelDistanceKm: num(b.travelDistanceKm),
    carpoolPeople: b.carpoolMemberCount + 1,
    submittedAt: b.submittedAt ? b.submittedAt.toISOString() : null,
  };
}

/** openapi BookingDetail (Booking + carpoolMembers + scoreBreakdown once allocation has run). */
function toBookingDetail(b: BookingDetail) {
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
    submittedAt: b.submittedAt ? b.submittedAt.toISOString() : null,
    createdAt: b.createdAt.toISOString(),
    carpoolMembers: b.carpoolMembers.map((m) => ({
      id: m.id,
      name: m.name,
      employeeEmail: m.employeeEmail ?? null,
      sameCompany: m.sameCompany,
      isScored: m.isScored,
    })),
    scoreBreakdown: b.scoreBreakdown
      ? {
          distanceKm: num(b.travelDistanceKm),
          people: b.scoreBreakdown.travellerCount,
          distanceScore: Number(b.scoreBreakdown.distanceScore),
          carpoolScore: Number(b.scoreBreakdown.carpoolScore),
          distanceWeight: Number(b.scoreBreakdown.distanceWeight),
          carpoolWeight: Number(b.scoreBreakdown.carpoolWeight),
          finalScore: Number(b.scoreBreakdown.finalScore),
        }
      : null,
  };
}

/** openapi AdminBooking — a booking row for the admin dashboards (who / when / status / slot). */
function toAdminBooking(b: AdminBookingHistoryRow) {
  const allocationSource = b.allocation
    ? b.allocation.isManualOverride
      ? 'MANUAL_OVERRIDE'
      : b.allocation.allocationRunId
        ? b.allocation.allocationType
        : 'RELEASED_SLOT'
    : null;

  return {
    id: b.id,
    bookingDate: isoDate(b.bookingDate),
    bookingType: b.bookingType,
    allocationSource,
    status: b.status,
    employeeName: b.user.fullName,
    employeeEmail: b.user.email,
    companyId: b.companyId,
    companyName: b.company.name,
    travelDistanceKm: num(b.travelDistanceKm),
    carpoolPeople: b.carpoolMemberCount + 1,
    allocationScore: num(b.allocationScore),
    allocatedSlotNumber: b.allocation?.slot?.slotNumber ?? null,
    submittedAt: b.submittedAt ? b.submittedAt.toISOString() : null,
    createdAt: b.createdAt.toISOString(),
  };
}

function toAdminBookingRow(b: AdminBookingRow) {
  return {
    ...toAdminBooking(b),
    history: b.history.map(toAdminBooking),
  };
}

export const listBookings = asyncHandler(async (req, res) => {
  if (!req.user) throw new UnauthenticatedError();
  const p = parsePagination(req.query as Record<string, unknown>);
  const { rows, total } = await service.listBookings(
    req.user,
    {
      date: req.query.date as string | undefined,
      companyId: req.query.companyId as string | undefined,
      status: req.query.status as AdminBookingRow['status'] | undefined,
    },
    p,
  );
  sendSuccess(res, rows.map(toAdminBookingRow), 200, { page: p.page, pageSize: p.pageSize, total });
});

export const createBooking = asyncHandler(async (req, res) => {
  if (!req.user) throw new UnauthenticatedError();
  const booking = await service.createBooking(req.user.id, req.body);
  sendSuccess(res, toBookingCreated(booking), 201);
});

export const updateBooking = asyncHandler(async (req, res) => {
  if (!req.user) throw new UnauthenticatedError();
  const booking = await service.updateBooking(req.user.id, req.params.id, req.body);
  sendSuccess(res, toBookingDetail(booking), 200);
});

export const releaseBooking = asyncHandler(async (req, res) => {
  if (!req.user) throw new UnauthenticatedError();
  const booking = await service.releaseBooking(req.user, req.params.id, req.body ?? {});
  sendSuccess(res, toBookingDetail(booking), 200);
});

export const getBooking = asyncHandler(async (req, res) => {
  if (!req.user) throw new UnauthenticatedError();
  const booking = await service.getBookingForPrincipal(req.user, req.params.id);
  sendSuccess(res, toBookingDetail(booking), 200);
});
