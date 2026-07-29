import type { CompanyStatus, UserStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { isUniqueViolation } from '../../lib/prismaErrors';
import type { PageArgs } from '../../lib/pagination';

const userInclude = { roles: { include: { role: true } }, company: true } as const;

export async function createCompany(input: { name: string; code: string }) {
  try {
    return await prisma.company.create({ data: { name: input.name, code: input.code } });
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
  await getCompany(id);
  return prisma.company.update({ where: { id }, data: { name: input.name } });
}

export async function setCompanyStatus(id: string, status: CompanyStatus) {
  await getCompany(id);
  return prisma.company.update({ where: { id }, data: { status } });
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
  ]);
  return { message: 'Company admin assigned' };
}
