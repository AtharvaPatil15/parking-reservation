import { z } from 'zod';
import { isBookableWeekday } from '../../lib/dates';

/** Mirrors the server's `MAX_BATCH_DATES` — the most weekdays a maximum 4-week window can hold. */
export const MAX_BOOKING_DATES = 20;

// Booking is car-only for the demo — the vehicle is always a CAR, so there's no vehicle-type field.
export const bookingSchema = z
  .object({
    // Multi-date: one request per selected date, same trip details on each. The picker only lets a
    // requestable date be selected, so the weekday/window rule is checked per entry as a backstop
    // against a stale grid rather than as the primary guard.
    bookingDates: z
      .array(z.string().min(1).refine(isBookableWeekday, 'Pick weekdays (Mon–Fri), today or later.'))
      .min(1, 'Select at least one date.')
      .max(MAX_BOOKING_DATES, `Up to ${MAX_BOOKING_DATES} dates at a time.`),
    vehicleNumber: z.string().optional(),
    // NOTE: `4` mirrors the backend default of `carpool.maxPeople` (D8). The real cap is
    // configurable (SystemConfiguration) and the contract bakes in no fixed max — if an SA
    // raises it, this client cap should be sourced from `useConfig()` rather than hardcoded.
    // Kept static for the demo (cap stays 4); the backend is the authority and 422s violations.
    carpoolPeople: z.coerce.number({ invalid_type_error: 'Enter a number.' }).int('Whole number.').min(1, 'At least 1 person.').max(4, 'Up to 4 people.'),
    specialRequirement: z.string().optional(),
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
