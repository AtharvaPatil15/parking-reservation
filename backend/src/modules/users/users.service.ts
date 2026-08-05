import type { BookingStatus, Prisma, UserStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors';
import { buildAuditData } from '../../lib/audit';
import type { PageArgs } from '../../lib/pagination';
import type { Role } from '../../lib/roles';
import { currentIstCalendarDate } from '../bookings/bookings.time';

const userInclude = { roles: { include: { role: true } }, company: true } as const;

interface Actor {
  id: string;
  role: Role;
  companyId: string;
}

/** Load a target user, enforcing tenant scope for non-super-admins (resource-level scoping). */
async function loadTargetUser(actor: Actor, userId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    include: userInclude,
  });
  if (!user) throw new NotFoundError('User not found');
  if (actor.role !== 'SUPER_ADMIN' && user.companyId !== actor.companyId) {
    // Hide cross-tenant existence — behave as not found.
    throw new NotFoundError('User not found');
  }
  return user;
}

/**
 * One applicant, in full — what the approval screens show in a details dialog before deciding
 * (2026-08-05).
 *
 * The queue rows carry name/email/status and nothing else, which is not enough to approve on: an admin
 * wants the home→office distance (it is what the person's allocation score is built from), the address
 * behind it, and which cars they have. Read through `loadTargetUser`, so a Company Admin asking about
 * another tenant's user gets the same "not found" as everywhere else.
 *
 * Vehicles are matched by `userId` OR by email: the registry links a car to a user by same-email
 * resolution, and a row imported before the person registered may only ever have the email.
 */
export async function getUserDetail(actor: Actor, userId: string) {
  const user = await loadTargetUser(actor, userId);
  const vehicles = await prisma.vehicle.findMany({
    where: {
      isActive: true,
      OR: [{ userId: user.id }, ...(user.email ? [{ ownerEmail: user.email }] : [])],
    },
    select: {
      id: true,
      vehicleNumber: true,
      displayNumber: true,
      vehicleType: true,
      makeModel: true,
      colour: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  return { user, vehicles };
}

/**
 * Roles whose registration only the Super Admin may action: company admins (F11) and, from Phase 7,
 * security/gate operators (D15). Both are privileged — a Company Admin must not be able to grant
 * either into their own tenant.
 */
const PRIVILEGED_ROLE_NAMES = ['COMPANY_ADMIN', 'SECURITY'];
const LIVE_BOOKING_STATUSES: BookingStatus[] = ['DRAFT', 'SUBMITTED', 'WAITLISTED', 'ALLOCATED'];
const REMOVED_USER_CANCELLATION_REASON = 'User removed';

function hasRole(user: Awaited<ReturnType<typeof loadTargetUser>>, role: Role | 'COMPANY_ADMIN' | 'SECURITY' | 'USER') {
  return user.roles.some((r) => r.role.name === role);
}

async function cancelLiveFutureBookingsForRemovedUser(tx: Prisma.TransactionClient, userId: string, now: Date) {
  const liveBookings = await tx.bookingRequest.findMany({
    where: {
      userId,
      bookingDate: { gte: currentIstCalendarDate(now) },
      status: { in: LIVE_BOOKING_STATUSES },
    },
    select: {
      id: true,
      bookingDate: true,
      allocation: { select: { slotId: true, allocationType: true } },
    },
  });
  const bookingIds = liveBookings.map((b) => b.id);
  if (bookingIds.length === 0) return 0;

  const commonPoolSlots = liveBookings
    .filter((b) => b.allocation?.allocationType === 'COMMON_POOL')
    .map((b) => ({ slotId: b.allocation!.slotId, bookingDate: b.bookingDate }));

  if (commonPoolSlots.length > 0) {
    await tx.commonPoolSlot.updateMany({
      where: { OR: commonPoolSlots, status: 'ALLOCATED' },
      data: { status: 'AVAILABLE' },
    });
  }

  await tx.parkingAllocation.deleteMany({ where: { bookingRequestId: { in: bookingIds } } });
  await tx.bookingRequest.updateMany({
    where: { id: { in: bookingIds } },
    data: {
      status: 'CANCELLED',
      cancellationTime: now,
      cancellationReason: REMOVED_USER_CANCELLATION_REASON,
    },
  });

  return bookingIds.length;
}

/**
 * List PENDING privileged registrations (COMPANY_ADMIN or SECURITY) across all companies — the Super
 * Admin's approval queue (F11 + Phase 7 D15). Route-guarded SUPER_ADMIN-only, so no tenant scoping
 * here. The caller can tell the two apart from each row's `roles`.
 */
export async function listPendingAdmins(opts: PageArgs) {
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    status: 'PENDING',
    roles: { some: { role: { name: { in: PRIVILEGED_ROLE_NAMES } } } },
  };
  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: userInclude,
      orderBy: { createdAt: 'desc' },
      skip: opts.skip,
      take: opts.take,
    }),
    prisma.user.count({ where }),
  ]);
  return { rows, total };
}

/**
 * List PROCESSED privileged registration requests (status ACTIVE or REJECTED), across all
 * companies — the Super Admin's approval history (F11 + Phase 7 D15), so decisions aren't lost once
 * actioned. SUPER_ADMIN-only route; newest decision first (by updatedAt).
 */
export async function listAdminRequestHistory(opts: PageArgs) {
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    status: { in: ['ACTIVE', 'REJECTED'] },
    roles: { some: { role: { name: { in: PRIVILEGED_ROLE_NAMES } } } },
  };
  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: userInclude,
      orderBy: { updatedAt: 'desc' },
      skip: opts.skip,
      take: opts.take,
    }),
    prisma.user.count({ where }),
  ]);
  return { rows, total };
}

export async function setApproval(actor: Actor, userId: string, decision: 'APPROVE' | 'REJECT') {
  const user = await loadTargetUser(actor, userId);
  if (user.status !== 'PENDING') {
    throw new ValidationError('Only PENDING users can be approved or rejected');
  }

  // A company-admin (F11) or security (Phase 7 D15) registration is privileged: only the Super Admin
  // may action it — a Company Admin cannot approve another admin, or a gate operator, into place.
  const isAdminRequest = user.roles.some((r) => r.role.name === 'COMPANY_ADMIN');
  const isSecurityRequest = user.roles.some((r) => r.role.name === 'SECURITY');
  if ((isAdminRequest || isSecurityRequest) && actor.role !== 'SUPER_ADMIN') {
    throw new ForbiddenError(
      isAdminRequest
        ? 'Company-admin registrations are approved by the super admin'
        : 'Security registrations are approved by the super admin',
    );
  }

  const newStatus: UserStatus = decision === 'APPROVE' ? 'ACTIVE' : 'REJECTED';
  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.user.update({ where: { id: userId }, data: { status: newStatus } }),
    prisma.auditLog.create({
      data: buildAuditData({
        actionType: 'USER_APPROVAL',
        entityType: 'User',
        entityId: userId,
        oldValue: { status: user.status },
        newValue: { status: newStatus, decision, grantedCompanyAdmin: isAdminRequest && decision === 'APPROVE' },
      }),
    }),
  ];

  // On approval of an admin request, grant the CompanyAdmin assignment (role already attached at
  // registration). Mirrors companies.service `assignCompanyAdmin`.
  if (isAdminRequest && decision === 'APPROVE') {
    ops.push(
      prisma.companyAdmin.upsert({
        where: { companyId_userId: { companyId: user.companyId, userId } },
        update: {},
        create: { companyId: user.companyId, userId, assignedById: actor.id },
      }),
      prisma.auditLog.create({
        data: buildAuditData({
          actionType: 'COMPANY_ADMIN_ASSIGNED',
          entityType: 'CompanyAdmin',
          entityId: user.companyId,
          newValue: { companyId: user.companyId, userId, via: 'registration' },
        }),
      }),
    );
  }

  await prisma.$transaction(ops);
  return prisma.user.findFirstOrThrow({ where: { id: userId }, include: userInclude });
}

export async function setStatus(actor: Actor, userId: string, status: UserStatus) {
  // Contract accepts the full UserStatus enum; this endpoint only activates/deactivates.
  if (status !== 'ACTIVE' && status !== 'INACTIVE') {
    throw new ValidationError('status must be ACTIVE or INACTIVE');
  }
  const user = await loadTargetUser(actor, userId);
  if (user.status === 'PENDING' || user.status === 'REJECTED') {
    throw new ValidationError(`Cannot set status from ${user.status}; approve or reject first`);
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { status } }),
    prisma.auditLog.create({
      data: buildAuditData({
        actionType: 'USER_STATUS_CHANGED',
        entityType: 'User',
        entityId: userId,
        oldValue: { status: user.status },
        newValue: { status },
      }),
    }),
  ]);
  return prisma.user.findFirstOrThrow({ where: { id: userId }, include: userInclude });
}

export async function removeUser(actor: Actor, userId: string) {
  const user = await loadTargetUser(actor, userId);
  if (user.id === actor.id) {
    throw new ValidationError('You cannot remove your own account');
  }

  const targetIsCompanyAdmin = hasRole(user, 'COMPANY_ADMIN');
  const targetIsSecurity = hasRole(user, 'SECURITY');

  if (actor.role === 'SUPER_ADMIN') {
    if (!targetIsCompanyAdmin && !targetIsSecurity) {
      throw new ForbiddenError('Super admin can remove company-admin and security users from this screen');
    }
  } else {
    if (targetIsCompanyAdmin || targetIsSecurity) {
      throw new ForbiddenError('Only the super admin can remove company-admin or security users');
    }
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const cancelledLiveBookingCount = await cancelLiveFutureBookingsForRemovedUser(tx, userId, now);

    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.companyAdmin.deleteMany({ where: { userId } });
    await tx.vehicle.updateMany({
      where: { userId },
      data: { isActive: false },
    });
    await tx.user.update({
      where: { id: userId },
      data: { status: 'INACTIVE', deletedAt: now },
    });
    await tx.auditLog.create({
      data: buildAuditData({
        actionType: 'USER_REMOVED',
        entityType: 'User',
        entityId: userId,
        oldValue: { status: user.status, role: user.roles[0]?.role.name ?? null, companyId: user.companyId },
        newValue: { deletedAt: true, removedBy: actor.role, cancelledLiveBookingCount },
      }),
    });
  });

  return { message: 'User removed' };
}

export type { Actor };
