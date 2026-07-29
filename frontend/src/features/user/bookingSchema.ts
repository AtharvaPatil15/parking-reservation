import { z } from 'zod';
import type { SelectOption } from '../../components';

export const VEHICLE_OPTIONS: SelectOption[] = [
  { value: 'CAR', label: 'Car' },
  { value: 'BIKE', label: 'Motorbike' },
  { value: 'EV_CAR', label: 'EV — Car' },
  { value: 'EV_BIKE', label: 'EV — Bike' },
  { value: 'OTHER', label: 'Other' },
];

/** True when `yyyy-mm-dd` is Mon–Fri and today-or-later (local date compare). */
export function isBookableWeekday(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return false;
  const day = date.getDay(); // 0=Sun..6=Sat
  if (day === 0 || day === 6) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date.getTime() >= today.getTime();
}

/** Next Mon–Fri (today if it's a weekday), as yyyy-mm-dd. */
export function nextBookableWeekday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export const bookingSchema = z.object({
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
});

export type BookingFormValues = z.input<typeof bookingSchema>;
