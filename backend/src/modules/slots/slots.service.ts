import type { SlotStatus, SlotType, BlockReason } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { isUniqueViolation, isForeignKeyViolation } from '../../lib/prismaErrors';
import { buildAuditData } from '../../lib/audit';
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
  // The @@unique([parkingAreaId, slotNumber]) constraint spans soft-deleted rows, so re-adding a
  // number that was deleted earlier would 409 against the dead row. Revive that row instead — it's
  // the same physical slot coming back into service — and refresh createdAt so it resurfaces at the
  // top of the newest-first list, exactly as a brand-new slot would.
  const dead = await prisma.parkingSlot.findFirst({
    where: { parkingAreaId: input.parkingAreaId, slotNumber: input.slotNumber, deletedAt: { not: null } },
  });
  if (dead) {
    return prisma.parkingSlot.update({
      where: { id: dead.id },
      data: {
        deletedAt: null,
        status: 'AVAILABLE',
        slotType: input.slotType ?? 'STANDARD',
        hasEvCharging: input.hasEvCharging ?? false,
        isAccessible: input.isAccessible ?? false,
        createdAt: new Date(),
      },
    });
  }

  try {
    return await prisma.parkingSlot.create({ data: input });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError('Slot number already exists in this area');
    // A bad parkingAreaId is a client error, not a server fault — surface it as 400, not 500.
    if (isForeignKeyViolation(err)) {
      throw new ValidationError('Request validation failed', [
        { field: 'parkingAreaId', message: 'Parking area not found — pick an existing area' },
      ]);
    }
    throw err;
  }
}

/** List parking areas (SUPER_ADMIN) — used to populate the slot-create area picker. */
export async function listParkingAreas() {
  return prisma.parkingArea.findMany({ orderBy: { name: 'asc' } });
}

/**
 * Create a parking area (SUPER_ADMIN) — e.g. "Basement 2". Single-office MVP: the area is
 * attached to the (only) office location, resolved server-side, so the client sends just a name.
 */
export async function createParkingArea(input: { name: string; floor?: string | null }) {
  const office = await prisma.officeLocation.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!office) throw new ValidationError('No office location is configured');
  return prisma.parkingArea.create({
    data: { name: input.name, floor: input.floor ?? null, officeLocationId: office.id },
  });
}

export async function listSlots(opts: { status?: SlotStatus; parkingAreaId?: string } & PageArgs) {
  const where = {
    deletedAt: null,
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.parkingAreaId ? { parkingAreaId: opts.parkingAreaId } : {}),
  };
  const [rows, total] = await Promise.all([
    // Newest first so a just-created slot lands at the top of page 1 — the SA sees what they
    // just added without hunting for it in slot-number order (secondary sort keeps it stable).
    prisma.parkingSlot.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { slotNumber: 'asc' }],
      skip: opts.skip,
      take: opts.take,
    }),
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

/** Soft-delete a slot (drops it from every count/list). */
export async function deleteSlot(id: string) {
  const existing = await prisma.parkingSlot.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new NotFoundError('Slot not found');
  await prisma.parkingSlot.update({ where: { id }, data: { deletedAt: new Date() } });
  return { message: 'Slot removed' };
}

/**
 * Count of physically-usable slots: not soft-deleted and not deactivated (INACTIVE). This is the
 * "in service" inventory the dashboard reports and the quota cap allots against.
 */
export function countInServiceSlots(): Promise<number> {
  return prisma.parkingSlot.count({ where: { deletedAt: null, status: { not: 'INACTIVE' } } });
}

// ---- Quota (SUPER_ADMIN) — effective-dated ---------------------------------

export async function createQuota(
  companyId: string,
  input: { slotCount: number; effectiveFrom: string; effectiveTo?: string | null },
  createdById?: string,
) {
  await assertCompanyExists(companyId);

  // Aggregate cap: a company's quota + every other active company's quota (as of this row's
  // effective date) must not exceed the building's physical slots — you can't promise more
  // parking than exists.
  const effectiveFrom = toDate(input.effectiveFrom);
  const totalSlots = await countInServiceSlots();
  const others = await prisma.company.findMany({
    where: { status: 'ACTIVE', deletedAt: null, id: { not: companyId } },
    select: { id: true },
  });
  let allottedElsewhere = 0;
  for (const other of others) allottedElsewhere += await getEffectiveQuota(other.id, effectiveFrom);
  const remaining = Math.max(0, totalSlots - allottedElsewhere);
  if (input.slotCount > remaining) {
    throw new ValidationError('Request validation failed', [
      {
        field: 'slotCount',
        message: `Exceeds available parking: the building has ${totalSlots} slots and other companies already hold ${allottedElsewhere}, so at most ${remaining} can be allotted here.`,
      },
    ]);
  }

  const effectiveTo = input.effectiveTo ? toDate(input.effectiveTo) : null;
  return prisma.$transaction(async (tx) => {
    // One quota row per (company, effectiveFrom): setting the same start date again replaces the
    // value instead of stacking a duplicate (which made getEffectiveQuota non-deterministic).
    const existing = await tx.companySlotAllocation.findFirst({ where: { companyId, effectiveFrom } });
    const row = existing
      ? await tx.companySlotAllocation.update({
          where: { id: existing.id },
          data: { slotCount: input.slotCount, effectiveTo, createdById },
        })
      : await tx.companySlotAllocation.create({
          data: { companyId, slotCount: input.slotCount, effectiveFrom, effectiveTo, createdById },
        });
    await tx.auditLog.create({
      data: buildAuditData({
        actionType: 'QUOTA_SET',
        entityType: 'CompanySlotAllocation',
        entityId: row.id,
        newValue: {
          companyId,
          slotCount: input.slotCount,
          effectiveFrom: input.effectiveFrom,
          effectiveTo: input.effectiveTo ?? null,
        },
      }),
    });
    return row;
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

  // Can't hold back more slots than the company actually has: on every day in the range,
  // already-blocked + this new count must not exceed that day's effective quota.
  const start = toDate(input.startDate);
  const end = toDate(input.endDate);
  const MS_DAY = 24 * 60 * 60 * 1000;
  const dayCount = Math.floor((end.getTime() - start.getTime()) / MS_DAY) + 1;
  for (let i = 0; i < dayCount; i++) {
    const day = new Date(start.getTime() + i * MS_DAY);
    const [quota, alreadyBlocked] = await Promise.all([
      getEffectiveQuota(companyId, day),
      getBlockedCount(companyId, day),
    ]);
    if (alreadyBlocked + input.blockedCount > quota) {
      const remaining = Math.max(0, quota - alreadyBlocked);
      throw new ValidationError('Request validation failed', [
        {
          field: 'blockedCount',
          message: `Cannot block ${input.blockedCount} slot(s) on ${day.toISOString().slice(0, 10)}: the company's quota is ${quota} with ${alreadyBlocked} already blocked, so at most ${remaining} more can be blocked.`,
        },
      ]);
    }
  }

  return prisma.$transaction(async (tx) => {
    const row = await tx.slotBlock.create({
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
    await tx.auditLog.create({
      data: buildAuditData({
        actionType: 'SLOT_BLOCKED',
        entityType: 'SlotBlock',
        entityId: row.id,
        newValue: {
          companyId,
          blockedCount: input.blockedCount,
          startDate: input.startDate,
          endDate: input.endDate,
          reason: input.reason,
        },
      }),
    });
    return row;
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
  await prisma.$transaction([
    prisma.slotBlock.delete({ where: { id: blockId } }),
    prisma.auditLog.create({
      data: buildAuditData({
        actionType: 'SLOT_UNBLOCKED',
        entityType: 'SlotBlock',
        entityId: blockId,
        oldValue: {
          companyId: block.companyId,
          blockedCount: block.blockedCount,
          startDate: block.startDate.toISOString().slice(0, 10),
          endDate: block.endDate.toISOString().slice(0, 10),
          reason: block.reason,
        },
      }),
    }),
  ]);
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
