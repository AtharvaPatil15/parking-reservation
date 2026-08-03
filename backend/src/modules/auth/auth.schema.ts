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
 *
 * Phase 7 (D15): a SECURITY applicant is a building gate operator, not an employee of a tenant. They
 * have no company to pick (the service assigns the building company) and no commute to record, so
 * `companyId` / `address` / `pinCode` are not collected from them. They are still *required* for
 * EMPLOYEE and COMPANY_ADMIN, which is why these are declared optional and then enforced
 * conditionally below rather than being loosened for everyone.
 */
const EMPLOYEE_ONLY_FIELDS = [
  { field: 'companyId', message: 'Company is required' },
  { field: 'address', message: 'Address is required' },
  { field: 'pinCode', message: 'PIN code is required' },
] as const;

export const registerSchema = z
  .object({
    fullName: z.string().min(1),
    companyId: z.string().min(1).optional(),
    email: z.string().email(),
    contactNumber: z.string().regex(/^\d{10}$/, 'Contact number must be 10 digits'),
    address: z.string().min(1).optional(),
    pinCode: z
      .string()
      .regex(/^\d{6}$/, 'PIN code must be 6 digits')
      .optional(),
    registrationType: z.enum(['EMPLOYEE', 'COMPANY_ADMIN', 'SECURITY']).default('EMPLOYEE'),
    distanceKm: z.number().min(0).max(200).nullable().optional(),
    password: z.string().min(1),
    confirmPassword: z.string().min(1),
  })
  .superRefine((v, ctx) => {
    if (v.password !== v.confirmPassword) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['confirmPassword'], message: 'Passwords do not match' });
    }
    // A guard supplies none of these; everyone else must.
    if (v.registrationType === 'SECURITY') return;
    for (const { field, message } of EMPLOYEE_ONLY_FIELDS) {
      if (!v[field]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message });
    }
  });
export type RegisterInput = z.infer<typeof registerSchema>;
