import { z } from 'zod';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Client-side registration validation. Mirrors the contract's `RegisterRequest`
 * (unique email + strength are enforced server-side; this front-runs the obvious
 * errors). `distanceKm` is optional at registration (D6) and, if given, 0–200.
 *
 * Phase 7 (D15): a SECURITY applicant is a building gate operator, so the form collects only name,
 * contact number, email and a password — no company, home address, PIN or commute distance. Those
 * fields stay required for EMPLOYEE/COMPANY_ADMIN, so they are declared as plain optional strings and
 * enforced in `superRefine` keyed on `registrationType`. The server applies the identical rule.
 */
const EMPLOYEE_ONLY_FIELDS = [
  { field: 'companyId', message: 'Select your company.' },
  { field: 'address', message: 'Address is required.' },
  { field: 'pinCode', message: 'PIN code is required.' },
] as const;

export const registerSchema = z
  .object({
    fullName: z.string().min(1, 'Full name is required.'),
    registrationType: z.enum(['EMPLOYEE', 'COMPANY_ADMIN', 'SECURITY']),
    companyId: z.string().optional(),
    email: z.string().min(1, 'Email is required.').regex(EMAIL_RE, 'Enter a valid email.'),
    contactNumber: z
      .string()
      .min(1, 'Contact number is required.')
      .regex(/^\d{10}$/, 'Enter a 10-digit phone number (digits only).'),
    address: z.string().optional(),
    pinCode: z.string().optional(),
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
  .superRefine((v, ctx) => {
    if (v.password !== v.confirmPassword) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['confirmPassword'], message: 'Passwords do not match.' });
    }
    // A guard supplies none of these; everyone else must.
    if (v.registrationType === 'SECURITY') return;
    for (const { field, message } of EMPLOYEE_ONLY_FIELDS) {
      if (!v[field]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message });
    }
    // Format checks only apply once we know the field is collected at all.
    if (v.pinCode && !/^\d{6}$/.test(v.pinCode)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pinCode'], message: 'PIN code must be 6 digits.' });
    }
  });

export type RegisterFormValues = z.input<typeof registerSchema>;
