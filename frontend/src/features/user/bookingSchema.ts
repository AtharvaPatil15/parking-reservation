import { z } from 'zod';
import type { SelectOption } from '../../components';
import { isBookableWeekday } from '../../lib/dates';

export const VEHICLE_OPTIONS: SelectOption[] = [
  { value: 'CAR', label: 'Car' },
  { value: 'BIKE', label: 'Motorbike' },
  { value: 'EV_CAR', label: 'EV — Car' },
  { value: 'EV_BIKE', label: 'EV — Bike' },
  { value: 'OTHER', label: 'Other' },
];

export const bookingSchema = z
  .object({
    bookingDate: z.string().min(1, 'Date is required.').refine(isBookableWeekday, 'Pick a weekday (Mon–Fri), today or later.'),
    vehicleType: z.enum(['CAR', 'BIKE', 'EV_CAR', 'EV_BIKE', 'OTHER']).optional().or(z.literal('')),
    vehicleNumber: z.string().optional(),
    carpoolPeople: z.coerce.number({ invalid_type_error: 'Enter a number.' }).int('Whole number.').min(1, 'At least 1 person.').max(4, 'Up to 4 people.'),
    specialRequirement: z.string().optional(),
    carpoolMembers: z
      .array(
        z.object({
          name: z.string().min(1, 'Name is required.'),
          employeeEmail: z.string().email('Enter a valid email.').optional().or(z.literal('')),
        }),
      )
      .optional(),
  })
  .refine((v) => !v.carpoolMembers || v.carpoolMembers.length <= v.carpoolPeople - 1, {
    path: ['carpoolMembers'],
    message: 'Too many carpool members for the number of people.',
  });

export type BookingFormValues = z.input<typeof bookingSchema>;
