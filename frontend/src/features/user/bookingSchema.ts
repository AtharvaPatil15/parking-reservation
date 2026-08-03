import { z } from 'zod';
import { isBookableWeekday } from '../../lib/dates';

// Booking is car-only for the demo — the vehicle is always a CAR, so there's no vehicle-type field.
export const bookingSchema = z
  .object({
    bookingDate: z.string().min(1, 'Date is required.').refine(isBookableWeekday, 'Pick a weekday (Mon–Fri), today or later.'),
    vehicleNumber: z.string().optional(),
    // NOTE: `4` mirrors the backend default of `carpool.maxPeople` (D8). The real cap is
    // configurable (SystemConfiguration) and the contract bakes in no fixed max — if an SA
    // raises it, this client cap should be sourced from `useConfig()` rather than hardcoded.
    // Kept static for the demo (cap stays 4); the backend is the authority and 422s violations.
    carpoolPeople: z.coerce.number({ invalid_type_error: 'Enter a number.' }).int('Whole number.').min(1, 'At least 1 person.').max(4, 'Up to 4 people.'),
    carpoolMembers: z
      .array(
        z.object({
          name: z.string().min(1, 'Name is required.'),
          // A carpool member is identified by their email; it must be a valid address and
          // (checked server-side on submit) belong to a registered user — any company.
          employeeEmail: z.string().min(1, 'Email is required.').email('Enter a valid email.'),
        }),
      )
      .optional(),
  })
  .refine((v) => !v.carpoolMembers || v.carpoolMembers.length <= v.carpoolPeople - 1, {
    path: ['carpoolMembers'],
    message: 'Too many carpool members for the number of people.',
  });

export type BookingFormValues = z.input<typeof bookingSchema>;
