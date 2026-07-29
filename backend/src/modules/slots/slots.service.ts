import type { SlotStatus, SlotType, BlockReason } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { isUniqueViolation } from '../../lib/prismaErrors';
import type { PageArgs } from '../../lib/pagination';
import type { Role } from '../../lib/roles';

const toDate = (s: string): Date => new Date(`${s}T00:00:00.000Z`);

async function assertCompanyExists(companyId: string) {
  const company = await prisma.company.findFirst({ where: { id: companyId, deletedAt: null } });
  if (!company) throw new NotFoundError('Company not found');
}

// ---- Slots (SUPER_ADMIN) ---------------------------------------------------

export async function createSlot(input: {
  slotNumber: string;
  parkingAreaId: string;
  slotType?: SlotType;
  hasEvCharging?: boolean;
  isAccessible?: boolean;
}) {
  try {
    return await prisma.parkingSlot.create({ data: input });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError('Slot number already exists in this area');
    throw err;
  }
}

export async function listSlots(opts: { status?: SlotStatus; parkingAreaId?: string } & PageArgs) {
  const where = {
    deletedAt: null,
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.parkingAreaId ? { parkingAreaId: opts.parkingAreaId } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.parkingSlot.findMany({ where, orderBy: { slotNumber: 'asc' }, skip: opts.skip, take: opts.take }),
    prisma.parkingSlot.count({ where }),
  ]);
  return { rows, total };
}

export async function updateSlot(
  id: string,
  input: Partial<{
    slotNumber: string;
    slotType: SlotType;
    status: SlotStatus;
    hasEvCharging: boolean;
    isAccessible: boolean;
  }>,
) {
  const existing = await prisma.parkingSlot.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new NotFoundError('Slot not found');
  return prisma.parkingSlot.update({ where: { id }, data: input });
}

// ---- Quota (SUPER_ADMIN) — effective-dated ---------------------------------

export async function createQuota(
  companyId: string,
  input: { slotCount: number; effectiveFrom: string; effectiveTo?: string | null },
  createdById?: string,
) {
  await assertCompanyExists(companyId);
  return prisma.companySlotAllocation.create({
    data: {
      companyId,
      slotCount: input.slotCount,
      effectiveFrom: toDate(input.effectiveFrom),
      effectiveTo: input.effectiveTo ? toDate(input.effectiveTo) : null,
      createdById,
    },
  });
}

export async function listQuota(companyId: string) {
  await assertCompanyExists(companyId);
  return prisma.companySlotAllocation.findMany({
    where: { companyId },
    orderBy: { effectiveFrom: 'desc' },
  });
}

// ---- Blocking (SUPER_ADMIN any / COMPANY_ADMIN own) ------------------------

export async function createBlock(
  companyId: string,
  input: {
    blockedCount: number;
    startDate: string;
    endDate: string;
    reason: BlockReason;
    reasonText?: string | null;
  },
  createdById?: string,
) {
  await assertCompanyExists(companyId);
  return prisma.slotBlock.create({
    data: {
      companyId,
      blockedCount: input.blockedCount,
      startDate: toDate(input.startDate),
      endDate: toDate(input.endDate),
      reason: input.reason,
      reasonText: input.reasonText ?? null,
      createdById,
    },
  });
}

export async function listBlocks(companyId: string, opts: PageArgs) {
  await assertCompanyExists(companyId);
  const where = { companyId };
  const [rows, total] = await Promise.all([
    prisma.slotBlock.findMany({ where, orderBy: { startDate: 'desc' }, skip: opts.skip, take: opts.take }),
    prisma.slotBlock.count({ where }),
  ]);
  return { rows, total };
}

export async function deleteBlock(actor: { role: Role; companyId: string }, blockId: string) {
  const block = await prisma.slotBlock.findUnique({ where: { id: blockId } });
  if (!block) throw new NotFoundError('Block not found');
  if (actor.role !== 'SUPER_ADMIN' && block.companyId !== actor.companyId) {
    throw new NotFoundError('Block not found'); // hide cross-tenant existence
  }
  await prisma.slotBlock.delete({ where: { id: blockId } });
  return { message: 'Block removed' };
}

// ---- Availability (used by allocation, P4-13) ------------------------------
// available = effective quota for the date − sum of blocked counts overlapping the date.

export async function getEffectiveQuota(companyId: string, date: Date): Promise<number> {
  const row = await prisma.companySlotAllocation.findFirst({
    where: {
      companyId,
      effectiveFrom: { lte: date },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
    },
    orderBy: { effectiveFrom: 'desc' },
  });
  return row?.slotCount ?? 0;
}

export async function getBlockedCount(companyId: string, date: Date): Promise<number> {
  const agg = await prisma.slotBlock.aggregate({
    _sum: { blockedCount: true },
    where: { companyId, startDate: { lte: date }, endDate: { gte: date } },
  });
  return agg._sum.blockedCount ?? 0;
}

export async function getAvailableQuota(companyId: string, date: Date): Promise<number> {
  const [quota, blocked] = await Promise.all([
    getEffectiveQuota(companyId, date),
    getBlockedCount(companyId, date),
  ]);
  return Math.max(0, quota - blocked);
}
