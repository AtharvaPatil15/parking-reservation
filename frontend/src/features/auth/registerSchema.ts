import { z } from 'zod';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Client-side registration validation. Mirrors the contract's `RegisterRequest`
 * (unique email + strength are enforced server-side; this front-runs the obvious
 * errors). `distanceKm` is optional at registration (D6) and, if given, 0–200.
 */
export const registerSchema = z
  .object({
    fullName: z.string().min(1, 'Full name is required.'),
    companyId: z.string().min(1, 'Select your company.'),
    email: z.string().min(1, 'Email is required.').regex(EMAIL_RE, 'Enter a valid email.'),
    contactNumber: z.string().min(1, 'Contact number is required.'),
    address: z.string().min(1, 'Address is required.'),
    pinCode: z.string().min(1, 'PIN code is required.'),
    distanceKm: z
      .string()
      .optional()
      .refine(
        (v) => !v || (!Number.isNaN(Number(v)) && Number(v) >= 0 && Number(v) <= 200),
        'Distance must be a number between 0 and 200 km.',
      ),
    password: z.string().min(8, 'Password must be at least 8 characters.'),
    confirmPassword: z.string().min(1, 'Confirm your password.'),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match.',
  });

export type RegisterFormValues = z.input<typeof registerSchema>;
