import type { ParkingSlot, CompanySlotAllocation, SlotBlock, SlotStatus } from '@prisma/client';
import { asyncHandler } from '../../lib/asyncHandler';
import { sendSuccess } from '../../lib/response';
import { parsePagination } from '../../lib/pagination';
import { UnauthenticatedError } from '../../lib/errors';
import * as service from './slots.service';

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

const toSlot = (s: ParkingSlot) => ({
  id: s.id,
  slotNumber: s.slotNumber,
  parkingAreaId: s.parkingAreaId,
  slotType: s.slotType,
  status: s.status,
  hasEvCharging: s.hasEvCharging,
  isAccessible: s.isAccessible,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});
const toQuota = (q: CompanySlotAllocation) => ({
  id: q.id,
  companyId: q.companyId,
  slotCount: q.slotCount,
  effectiveFrom: isoDate(q.effectiveFrom),
  effectiveTo: q.effectiveTo ? isoDate(q.effectiveTo) : null,
  createdAt: q.createdAt.toISOString(),
});
const toBlock = (b: SlotBlock) => ({
  id: b.id,
  companyId: b.companyId,
  blockedCount: b.blockedCount,
  startDate: isoDate(b.startDate),
  endDate: isoDate(b.endDate),
  reason: b.reason,
  reasonText: b.reasonText ?? null,
  createdAt: b.createdAt.toISOString(),
});

// Slots
export const createSlot = asyncHandler(async (req, res) => {
  sendSuccess(res, toSlot(await service.createSlot(req.body)), 201);
});
export const listSlots = asyncHandler(async (req, res) => {
  const p = parsePagination(req.query as Record<string, unknown>);
  const { rows, total } = await service.listSlots({
    status: req.query.status as SlotStatus | undefined,
    parkingAreaId: req.query.parkingAreaId as string | undefined,
    ...p,
  });
  sendSuccess(res, rows.map(toSlot), 200, { page: p.page, pageSize: p.pageSize, total });
});
export const updateSlot = asyncHandler(async (req, res) => {
  sendSuccess(res, toSlot(await service.updateSlot(req.params.id, req.body)));
});

// Quota
export const createQuota = asyncHandler(async (req, res) => {
  const q = await service.createQuota(req.params.id, req.body, req.user?.id);
  sendSuccess(res, toQuota(q), 201);
});
export const listQuota = asyncHandler(async (req, res) => {
  const rows = await service.listQuota(req.params.id);
  sendSuccess(res, rows.map(toQuota));
});

// Blocking
export const createBlock = asyncHandler(async (req, res) => {
  const b = await service.createBlock(req.params.id, req.body, req.user?.id);
  sendSuccess(res, toBlock(b), 201);
});
export const listBlocks = asyncHandler(async (req, res) => {
  const p = parsePagination(req.query as Record<string, unknown>);
  const { rows, total } = await service.listBlocks(req.params.id, p);
  sendSuccess(res, rows.map(toBlock), 200, { page: p.page, pageSize: p.pageSize, total });
});
export const deleteBlock = asyncHandler(async (req, res) => {
  if (!req.user) throw new UnauthenticatedError();
  sendSuccess(res, await service.deleteBlock(req.user, req.params.id));
});
