import type { Prisma, UserStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors';
import { buildAuditData } from '../../lib/audit';
import type { PageArgs } from '../../lib/pagination';
import type { Role } from '../../lib/roles';

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
 * List PENDING users who registered as COMPANY_ADMIN, across all companies — the Super Admin's
 * approval queue (F11). Route-guarded SUPER_ADMIN-only, so no tenant scoping here.
 */
export async function listPendingAdmins(opts: PageArgs) {
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    status: 'PENDING',
    roles: { some: { role: { name: 'COMPANY_ADMIN' } } },
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
 * List PROCESSED company-admin registration requests (status ACTIVE or REJECTED), across all
 * companies — the Super Admin's approval history (F11), so decisions aren't lost once actioned.
 * SUPER_ADMIN-only route; newest decision first (by updatedAt).
 */
export async function listAdminRequestHistory(opts: PageArgs) {
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    status: { in: ['ACTIVE', 'REJECTED'] },
    roles: { some: { role: { name: 'COMPANY_ADMIN' } } },
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

  // A company-admin registration (F11) is a privileged request: only the Super Admin may action
  // it — a Company Admin cannot approve another admin into their own company.
  const isAdminRequest = user.roles.some((r) => r.role.name === 'COMPANY_ADMIN');
  if (isAdminRequest && actor.role !== 'SUPER_ADMIN') {
    throw new ForbiddenError('Company-admin registrations are approved by the super admin');
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

export type { Actor };
