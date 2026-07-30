import { z } from 'zod';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');
const slotType = z.enum(['STANDARD', 'ACCESSIBLE', 'EV_CHARGING', 'VISITOR', 'RESERVED']);
const slotStatus = z.enum([
  'AVAILABLE',
  'ALLOCATED_TO_COMPANY',
  'BLOCKED',
  'BOOKED',
  'COMMON_POOL',
  'UNDER_MAINTENANCE',
  'INACTIVE',
]);
const blockReason = z.enum([
  'RESERVED_VISITOR',
  'RESERVED_LEADERSHIP',
  'MAINTENANCE',
  'COMPANY_EVENT',
  'EMERGENCY',
  'OTHER',
]);

export const createParkingAreaSchema = z.object({
  name: z.string().min(1),
  floor: z.string().min(1).nullable().optional(),
});

export const createSlotSchema = z.object({
  slotNumber: z.string().min(1),
  parkingAreaId: z.string().min(1),
  slotType: slotType.optional(),
  hasEvCharging: z.boolean().optional(),
  isAccessible: z.boolean().optional(),
});
export const updateSlotSchema = z
  .object({
    slotNumber: z.string().min(1),
    slotType,
    status: slotStatus,
    hasEvCharging: z.boolean(),
    isAccessible: z.boolean(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, { message: 'At least one field is required' });

export const listSlotsQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  status: slotStatus.optional(),
  parkingAreaId: z.string().optional(),
});

export const createQuotaSchema = z
  .object({
    slotCount: z.coerce.number().int().min(0),
    effectiveFrom: dateString,
    effectiveTo: dateString.nullable().optional(),
  })
  .refine((o) => !o.effectiveTo || o.effectiveTo >= o.effectiveFrom, {
    message: 'effectiveTo must be on or after effectiveFrom',
    path: ['effectiveTo'],
  });

export const createBlockSchema = z
  .object({
    blockedCount: z.coerce.number().int().min(1),
    startDate: dateString,
    endDate: dateString,
    reason: blockReason,
    reasonText: z.string().nullable().optional(),
  })
  .refine((o) => o.endDate >= o.startDate, {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  });

export const listBlocksQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});
