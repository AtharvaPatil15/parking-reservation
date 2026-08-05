import { z } from 'zod';

const vehicleNumber = z.string().trim().min(4, 'Car number is too short').max(16, 'Car number is too long');

/** openapi `UpdateProfileRequest` — partial self-profile update; at least one field. */
export const updateProfileSchema = z
  .object({
    fullName: z.string().min(1).optional(),
    contactNumber: z.string().regex(/^\d{10}$/, 'Contact number must be 10 digits').optional(),
    address: z.string().min(1).optional(),
    pinCode: z.string().regex(/^\d{6}$/, 'PIN code must be 6 digits').optional(),
    distanceKm: z.number().min(0).max(200).nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'At least one field is required' });
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const createMyVehicleSchema = z.object({
  vehicleNumber,
  displayNumber: z.string().trim().min(4).max(24).optional(),
  vehicleType: z.enum(['CAR', 'EV_CAR', 'BIKE']).default('CAR').optional(),
  makeModel: z.string().trim().min(1).max(80).nullable().optional(),
  colour: z.string().trim().min(1).max(40).nullable().optional(),
  notes: z.string().trim().min(1).max(500).nullable().optional(),
});
export type CreateMyVehicleInput = z.infer<typeof createMyVehicleSchema>;

/**
 * openapi `UpdateMyVehicleRequest` — same field set as create, every one optional, plus a
 * "change something" guard so an empty PATCH is a 400 rather than a silent no-op.
 */
export const updateMyVehicleSchema = z
  .object({
    vehicleNumber: vehicleNumber.optional(),
    displayNumber: z.string().trim().min(4).max(24).optional(),
    vehicleType: z.enum(['CAR', 'EV_CAR', 'BIKE']).optional(),
    makeModel: z.string().trim().min(1).max(80).nullable().optional(),
    colour: z.string().trim().min(1).max(40).nullable().optional(),
    notes: z.string().trim().min(1).max(500).nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'At least one field is required' });
export type UpdateMyVehicleInput = z.infer<typeof updateMyVehicleSchema>;

const bookingStatus = z.enum([
  'DRAFT', 'SUBMITTED', 'CANCELLED', 'ALLOCATED', 'WAITLISTED', 'REJECTED', 'RELEASED', 'EXPIRED',
]);
export const myBookingsQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  status: bookingStatus.optional(),
});
