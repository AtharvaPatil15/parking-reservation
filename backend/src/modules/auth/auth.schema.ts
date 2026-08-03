import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Registration (P4-20) — mirrors openapi `RegisterRequest`. Structural/format checks here;
 * server-authoritative rules (company must be ACTIVE, password.minLength (D8), unique email)
 * live in the service. `distanceKm` is optional at sign-up (D6), range 0–200 (F5).
 */
export const registerSchema = z
  .object({
    fullName: z.string().min(1),
    companyId: z.string().min(1),
    email: z.string().email(),
    contactNumber: z.string().regex(/^\d{10}$/, 'Contact number must be 10 digits'),
    address: z.string().min(1),
    pinCode: z.string().regex(/^\d{6}$/, 'PIN code must be 6 digits'),
    registrationType: z.enum(['EMPLOYEE', 'COMPANY_ADMIN', 'SECURITY']).default('EMPLOYEE'),
    distanceKm: z.number().min(0).max(200).nullable().optional(),
    password: z.string().min(1),
    confirmPassword: z.string().min(1),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });
export type RegisterInput = z.infer<typeof registerSchema>;
