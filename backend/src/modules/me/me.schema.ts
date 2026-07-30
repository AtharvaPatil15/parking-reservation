import { z } from 'zod';

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

const bookingStatus = z.enum([
  'DRAFT', 'SUBMITTED', 'CANCELLED', 'ALLOCATED', 'WAITLISTED', 'REJECTED', 'RELEASED', 'EXPIRED',
]);
export const myBookingsQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  status: bookingStatus.optional(),
});
