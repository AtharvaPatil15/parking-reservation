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

/** Per-company capacity for a date (defaults to today) — the gate's "is there room?" panel. */
export const gateCapacityQuery = z.object({ date: dateString.optional() });
export type GateCapacityQuery = z.infer<typeof gateCapacityQuery>;

/**
 * A walk-in car the guard is asking to have registered.
 *
 * Deliberately the four things a guard can actually establish at a barrier — plate, who says they own
 * it, how to reach them, and which company they claim — plus optional descriptive fields. Notably NOT
 * address/pin code/home distance: those belong to a user account, which this does not create, and a
 * guard cannot verify them anyway.
 */
export const createRegistrationSchema = z.object({
  vehicleNumber,
  displayNumber: z.string().trim().min(1).max(20).optional(),
  ownerName: z.string().trim().min(2, 'Enter the person’s name').max(120),
  ownerEmail: z.string().trim().email('Not a valid email').max(200).optional(),
  contactNumber: z.string().trim().min(6, 'Contact number is too short').max(20).optional(),
  companyId: z.string().min(1, 'Pick the company they work for'),
  vehicleType: z.enum(['CAR', 'BIKE', 'EV_CAR', 'EV_BIKE']).optional(),
  makeModel: z.string().trim().min(1).max(120).optional(),
  colour: z.string().trim().min(1).max(40).optional(),
  notes: z.string().trim().min(1).max(500).optional(),
});
export type CreateRegistrationInput = z.infer<typeof createRegistrationSchema>;

export const registrationsQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  companyId: z.string().min(1).optional(),
});
export type RegistrationsQuery = z.infer<typeof registrationsQuery>;

export const registrationDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().trim().min(1).max(500).optional(),
});
export type RegistrationDecisionInput = z.infer<typeof registrationDecisionSchema>;
