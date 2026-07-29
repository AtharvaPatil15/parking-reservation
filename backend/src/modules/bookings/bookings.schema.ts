import { z } from 'zod';

/** Booking request DTOs (P4-12), mirroring openapi `CreateBookingRequest` / `CarpoolMemberInput`. */

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');
const vehicleType = z.enum(['CAR', 'BIKE', 'EV_CAR', 'EV_BIKE', 'OTHER']);

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
