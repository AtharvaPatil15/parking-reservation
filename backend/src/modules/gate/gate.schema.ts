import { z } from 'zod';

/** Gate DTOs (Phase 7 §5). Plates are normalized in the service, so shape validation stays loose. */

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');
// Indian plates run ~9–10 characters normalized; allow 4–16 raw so odd/old formats and typed spaces
// still pass. Rejecting a real car at the barrier would be worse than accepting a sloppy string.
const vehicleNumber = z.string().trim().min(4, 'Car number is too short').max(16, 'Car number is too long');

export const vehicleSearchQuery = z.object({
  search: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().positive().max(25).optional(),
});
export type VehicleSearchQuery = z.infer<typeof vehicleSearchQuery>;

export const vehicleLookupQuery = z.object({ number: vehicleNumber });
export type VehicleLookupQuery = z.infer<typeof vehicleLookupQuery>;

export const checkInSchema = z.object({
  vehicleNumber,
  notes: z.string().trim().min(1).max(500).nullable().optional(),
});
export type CheckInInput = z.infer<typeof checkInSchema>;

export const checkOutSchema = z.object({
  vehicleNumber,
  notes: z.string().trim().min(1).max(500).nullable().optional(),
});
export type CheckOutInput = z.infer<typeof checkOutSchema>;

export const gateEventsQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  date: dateString.optional(),
  status: z.enum(['CHECKED_IN', 'CHECKED_OUT']).optional(),
});
export type GateEventsQuery = z.infer<typeof gateEventsQuery>;

export const unbookedQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  date: dateString.optional(),
  companyId: z.string().min(1).optional(),
});
export type UnbookedQuery = z.infer<typeof unbookedQuery>;
