import { z } from 'zod';

/** Booking request DTOs (P4-12), mirroring openapi `CreateBookingRequest` / `CarpoolMemberInput`. */

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');
const vehicleType = z.enum(['CAR', 'BIKE', 'EV_CAR', 'EV_BIKE', 'OTHER']);
const bookingStatus = z.enum([
  'DRAFT',
  'SUBMITTED',
  'CANCELLED',
  'ALLOCATED',
  'WAITLISTED',
  'REJECTED',
  'RELEASED',
  'EXPIRED',
]);

const carpoolMemberInput = z.object({
  name: z.string().min(1),
  // Same-company employee email; only validated same-company employees are scored (F4).
  employeeEmail: z.string().email().nullable().optional(),
  contactNumber: z.string().min(1).nullable().optional(),
  pickupLocation: z.string().min(1).nullable().optional(),
});

export const createBookingSchema = z.object({
  bookingDate: dateString,
  vehicleType: vehicleType.optional(),
  vehicleNumber: z.string().min(1).nullable().optional(),
  // Total people incl. the driver as person 1 (D3). Upper bound (carpool.maxPeople, D8) is
  // enforced in the service against live config, so a config change needs no re-spec.
  carpoolPeople: z.coerce.number().int().min(1),
  specialRequirement: z.string().min(1).nullable().optional(),
  carpoolMembers: z.array(carpoolMemberInput).optional(),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type CarpoolMemberInput = z.infer<typeof carpoolMemberInput>;

/**
 * Multi-date booking (openapi `CreateBookingsBatchRequest`). The trip details are shared; only the
 * date varies, so this is `createBookingSchema` with `bookingDate` swapped for a list.
 *
 * The cap is the most weekdays a maximum 4-week window can hold (4 × 5), so it can never reject a
 * legitimate selection while still bounding what one request can do. Duplicates are collapsed here
 * rather than rejected: selecting the same date twice is a UI slip, not an error worth a 400.
 */
export const MAX_BATCH_DATES = 20;

export const createBookingsBatchSchema = createBookingSchema
  .omit({ bookingDate: true })
  .extend({
    bookingDates: z
      .array(dateString)
      .min(1, 'Select at least one date')
      .transform((dates) => [...new Set(dates)].sort())
      // Checked after de-duplication, so 20 distinct dates pass even if the client sent repeats.
      .refine((dates) => dates.length <= MAX_BATCH_DATES, `Cannot book more than ${MAX_BATCH_DATES} dates at once`),
  });

export type CreateBookingsBatchInput = z.infer<typeof createBookingsBatchSchema>;

/**
 * Slot-grid query (GET /availability, Phase 7 §4). Both bounds optional: with neither, the service
 * answers for the whole currently-open window, which is what the booking form asks for.
 */
export const availabilityQuery = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
});
export type AvailabilityQuery = z.infer<typeof availabilityQuery>;

/** Partial edit before the primary cutoff (openapi `UpdateBookingRequest`). At least one field. */
export const updateBookingSchema = z
  .object({
    vehicleType: vehicleType.optional(),
    vehicleNumber: z.string().min(1).nullable().optional(),
    carpoolPeople: z.coerce.number().int().min(1).optional(),
    specialRequirement: z.string().min(1).nullable().optional(),
    carpoolMembers: z.array(carpoolMemberInput).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'At least one field is required' });
export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;

const releaseBookingBodySchema = z.object({
  reason: z.string().min(1).nullable().optional(),
});

/** Release an allocated slot (openapi `ReleaseBookingRequest`). Body is optional — no body becomes `{}`. */
export const releaseBookingSchema = z.preprocess((body) => body ?? {}, releaseBookingBodySchema);
export type ReleaseBookingInput = z.infer<typeof releaseBookingBodySchema>;

/**
 * Admin booking-list query (GET /bookings). COMPANY_ADMIN is scoped to their own company in the
 * service; `companyId` is honoured only for SUPER_ADMIN. `date` filters by bookingDate.
 */
export const listBookingsQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  date: dateString.optional(),
  companyId: z.string().min(1).optional(),
  status: bookingStatus.optional(),
});
export type ListBookingsQuery = z.infer<typeof listBookingsQuery>;
