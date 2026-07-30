import { z } from 'zod';

export const createCompanySchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
});
export const updateCompanySchema = z.object({ name: z.string().min(1) });
export const updateStatusSchema = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) });
export const assignAdminSchema = z.object({ userId: z.string().min(1) });

export const listCompaniesQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});
export const quotaSummaryQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
});
export const listUsersQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  status: z.enum(['PENDING', 'ACTIVE', 'REJECTED', 'INACTIVE']).optional(),
});
