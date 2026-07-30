import { prisma } from '../../lib/prisma';
import { getEffectiveQuota, getBlockedCount, countInServiceSlots } from '../slots/slots.service';
import { getString } from '../../config/systemConfig';

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function superAdminDashboard(date: Date) {
  const [totalParkingSlots, totalActiveCompanies, bookedSlots, primaryBookings, commonPoolBookings, waitlistCount, blockedAgg] =
    await Promise.all([
      countInServiceSlots(),
      prisma.company.count({ where: { status: 'ACTIVE', deletedAt: null } }),
      prisma.parkingAllocation.count({ where: { bookingDate: date } }),
      prisma.bookingRequest.count({ where: { bookingDate: date, bookingType: 'PRIMARY' } }),
      prisma.bookingRequest.count({ where: { bookingDate: date, bookingType: 'COMMON_POOL' } }),
      prisma.bookingRequest.count({ where: { bookingDate: date, status: 'WAITLISTED' } }),
      prisma.slotBlock.aggregate({ _sum: { blockedCount: true }, where: { startDate: { lte: date }, endDate: { gte: date } } }),
    ]);
  const blockedSlots = blockedAgg._sum.blockedCount ?? 0;
  const availableSlots = Math.max(0, totalParkingSlots - bookedSlots - blockedSlots);
  return {
    totalParkingSlots,
    totalActiveCompanies,
    blockedSlots,
    availableSlots,
    primaryBookings,
    commonPoolBookings,
    waitlistCount,
    dailyUtilizationPct: totalParkingSlots > 0 ? round2((bookedSlots / totalParkingSlots) * 100) : 0,
  };
}

export async function companyAdminDashboard(companyId: string, date: Date) {
  const [totalCompanySlots, blockedSlots, bookedSlots, commonPoolSlots, totalBookingRequests, waitlistedUsers] =
    await Promise.all([
      getEffectiveQuota(companyId, date),
      getBlockedCount(companyId, date),
      prisma.parkingAllocation.count({ where: { companyId, bookingDate: date } }),
      prisma.commonPoolSlot.count({ where: { sourceCompanyId: companyId, bookingDate: date } }),
      prisma.bookingRequest.count({ where: { companyId, bookingDate: date } }),
      prisma.bookingRequest.count({ where: { companyId, bookingDate: date, status: 'WAITLISTED' } }),
    ]);
  return {
    totalCompanySlots,
    availableCompanySlots: Math.max(0, totalCompanySlots - blockedSlots - bookedSlots),
    blockedSlots,
    bookedSlots,
    commonPoolSlots,
    totalBookingRequests,
    allocatedUsers: bookedSlots, // one allocation == one allocated user
    waitlistedUsers,
    dailyUtilizationPct: totalCompanySlots > 0 ? round2((bookedSlots / totalCompanySlots) * 100) : 0,
  };
}

function cutoffCountdownSeconds(cutoff: string): number | null {
  const [h, m] = cutoff.split(':').map(Number);
  const now = Date.now();
  const istMs = 5.5 * 3600 * 1000;
  const ist = new Date(now + istMs);
  const targetUtc = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), h, m) - istMs;
  const diff = Math.floor((targetUtc - now) / 1000);
  return diff > 0 ? diff : null;
}

export async function userDashboard(userId: string, date: Date) {
  const [previousBookingsCount, upcoming, cutoff] = await Promise.all([
    prisma.bookingRequest.count({ where: { userId, bookingDate: { lt: date } } }),
    prisma.bookingRequest.findFirst({
      where: {
        userId,
        bookingDate: { gte: date },
        status: { in: ['DRAFT', 'SUBMITTED', 'ALLOCATED', 'WAITLISTED'] },
      },
      orderBy: { bookingDate: 'asc' },
      include: { allocation: { include: { slot: true } } },
    }),
    getString('booking.primaryCutoff', '18:00'),
  ]);

  const upcomingBooking = upcoming
    ? {
        id: upcoming.id,
        bookingDate: upcoming.bookingDate.toISOString().slice(0, 10),
        bookingType: upcoming.bookingType,
        status: upcoming.status,
        travelDistanceKm: upcoming.travelDistanceKm != null ? Number(upcoming.travelDistanceKm) : null,
        vehicleType: upcoming.vehicleType ?? undefined,
        vehicleNumber: upcoming.vehicleNumber ?? null,
        carpoolMemberCount: upcoming.carpoolMemberCount,
        specialRequirement: upcoming.specialRequirement ?? null,
        allocationScore: upcoming.allocationScore != null ? Number(upcoming.allocationScore) : null,
        allocatedSlotNumber: upcoming.allocation?.slot?.slotNumber ?? null,
        submittedAt: upcoming.submittedAt ? upcoming.submittedAt.toISOString() : null,
        createdAt: upcoming.createdAt.toISOString(),
      }
    : undefined;

  return {
    ...(upcomingBooking ? { upcomingBooking } : {}),
    cutoffCountdownSeconds: cutoffCountdownSeconds(cutoff ?? '18:00'),
    previousBookingsCount,
  };
}
