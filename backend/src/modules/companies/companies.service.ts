import type { CompanyStatus, UserStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { isUniqueViolation } from '../../lib/prismaErrors';
import { buildAuditData } from '../../lib/audit';
import { getEffectiveQuota } from '../slots/slots.service';
import { LIVE_BOOKING_STATUSES } from '../bookings/bookings.availability';
import type { PageArgs } from '../../lib/pagination';

const userInclude = { roles: { include: { role: true } }, company: true } as const;

export async function createCompany(input: { name: string; code: string }) {
  try {
    return await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({ data: { name: input.name, code: input.code } });
      await tx.auditLog.create({
        data: buildAuditData({
          actionType: 'COMPANY_CREATED',
          entityType: 'Company',
          entityId: company.id,
          newValue: { name: company.name, code: company.code, status: company.status },
        }),
      });
      return company;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError('Company code already exists');
    throw err;
  }
}

export async function listCompanies(opts: { status?: CompanyStatus } & PageArgs) {
  const where = { deletedAt: null, ...(opts.status ? { status: opts.status } : {}) };
  const [rows, total] = await Promise.all([
    prisma.company.findMany({ where, orderBy: { name: 'asc' }, skip: opts.skip, take: opts.take }),
    prisma.company.count({ where }),
  ]);
  return { rows, total };
}

export function listActiveCompanies() {
  return prisma.company.findMany({
    where: { status: 'ACTIVE', deletedAt: null },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
}

export async function getCompany(id: string) {
  const company = await prisma.company.findFirst({ where: { id, deletedAt: null } });
  if (!company) throw new NotFoundError('Company not found');
  return company;
}

export async function updateCompany(id: string, input: { name: string }) {
  const before = await getCompany(id);
  return prisma.$transaction(async (tx) => {
    const after = await tx.company.update({ where: { id }, data: { name: input.name } });
    await tx.auditLog.create({
      data: buildAuditData({
        actionType: 'COMPANY_UPDATED',
        entityType: 'Company',
        entityId: id,
        oldValue: { name: before.name },
        newValue: { name: after.name },
      }),
    });
    return after;
  });
}

export async function setCompanyStatus(id: string, status: CompanyStatus) {
  const before = await getCompany(id);
  return prisma.$transaction(async (tx) => {
    const after = await tx.company.update({ where: { id }, data: { status } });
    await tx.auditLog.create({
      data: buildAuditData({
        actionType: 'COMPANY_STATUS_CHANGED',
        entityType: 'Company',
        entityId: id,
        oldValue: { status: before.status },
        newValue: { status },
      }),
    });
    return after;
  });
}

/**
 * Soft-delete a tenant (SA). Sets `deletedAt`, which every other query in the codebase already filters
 * on — so the company disappears from the lists, the registration dropdown and the gate capacity panel
 * without touching a single historical row.
 *
 * **Guarded, not cascading.** Deleting a company that still has members would leave those users able to
 * log in against a tenant that no longer exists, and would orphan their bookings mid-flight. So both are
 * refused with a 409 that names the count: the Super Admin deactivates and clears the company first,
 * which is a deliberate sequence rather than one irreversible click.
 *
 * The `code` is released on the way out. It is UNIQUE across all rows including soft-deleted ones, so a
 * deleted company would otherwise squat on its code forever and re-creating the same tenant would fail
 * with a confusing "code already exists". The original is preserved in the audit log's `oldValue`.
 */
export async function deleteCompany(id: string) {
  const company = await getCompany(id);

  const [userCount, liveBookings] = await Promise.all([
    prisma.user.count({ where: { companyId: id, deletedAt: null } }),
    prisma.bookingRequest.count({ where: { companyId: id, status: { in: LIVE_BOOKING_STATUSES } } }),
  ]);
  if (userCount > 0) {
    throw new ConflictError(
      `${company.name} still has ${userCount} user${userCount === 1 ? '' : 's'} — remove them before deleting the company`,
    );
  }
  if (liveBookings > 0) {
    throw new ConflictError(
      `${company.name} has ${liveBookings} booking${liveBookings === 1 ? '' : 's'} still in play — wait for them to finish or cancel them first`,
    );
  }

  const deletedAt = new Date();
  // Suffix rather than blank: `code` is NOT NULL, and two companies deleted on the same day must not
  // collide with each other either. The timestamp makes the released name unique per deletion.
  const releasedCode = `${company.code}__deleted_${deletedAt.getTime()}`;

  return prisma.$transaction(async (tx) => {
    const after = await tx.company.update({
      where: { id },
      data: { deletedAt, status: 'INACTIVE', code: releasedCode },
    });
    await tx.auditLog.create({
      data: buildAuditData({
        actionType: 'COMPANY_DELETED',
        entityType: 'Company',
        entityId: id,
        oldValue: { name: company.name, code: company.code, status: company.status },
        newValue: { deletedAt: deletedAt.toISOString(), code: releasedCode, status: 'INACTIVE' },
      }),
    });
    return after;
  });
}

/**
 * Effective assigned slot quota per company on a date (SA). Resolves each company's effective-dated
 * `CompanySlotAllocation` row for `date` (0 when none applies). Powers the Companies "Assigned" column.
 */
export async function quotaSummary(date: Date) {
  const companies = await prisma.company.findMany({
    where: { deletedAt: null },
    orderBy: { name: 'asc' },
    select: { id: true },
  });
  return Promise.all(
    companies.map(async (c) => ({ companyId: c.id, assignedSlots: await getEffectiveQuota(c.id, date) })),
  );
}

export async function listCompanyUsers(
  companyId: string,
  opts: { status?: UserStatus } & PageArgs,
) {
  const where = { companyId, deletedAt: null, ...(opts.status ? { status: opts.status } : {}) };
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

export async function assignCompanyAdmin(companyId: string, userId: string, assignedById?: string) {
  await getCompany(companyId);
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (!user) throw new NotFoundError('User not found');
  if (user.companyId !== companyId) {
    throw new ValidationError('User does not belong to this company');
  }

  const role = await prisma.role.findUnique({ where: { name: 'COMPANY_ADMIN' } });
  if (!role) throw new Error('COMPANY_ADMIN role missing (seed not applied)');

  await prisma.$transaction([
    prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId: role.id } },
      update: {},
      create: { userId, roleId: role.id },
    }),
    prisma.companyAdmin.upsert({
      where: { companyId_userId: { companyId, userId } },
      update: {},
      create: { companyId, userId, assignedById },
    }),
    prisma.auditLog.create({
      data: buildAuditData({
        actionType: 'COMPANY_ADMIN_ASSIGNED',
        entityType: 'CompanyAdmin',
        entityId: companyId,
        newValue: { companyId, userId },
      }),
    }),
  ]);
  return { message: 'Company admin assigned' };
}
