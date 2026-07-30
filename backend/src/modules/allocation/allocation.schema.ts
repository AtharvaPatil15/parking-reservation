import { z } from 'zod';

/** Allocation request DTOs (P4-13), mirroring openapi `PrimaryRunRequest`. */
export const primaryRunSchema = z.object({
  bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
});

export type PrimaryRunInput = z.infer<typeof primaryRunSchema>;

/**
 * Allocation roster query (GET /allocations). COMPANY_ADMIN is scoped to their own company in the
 * service; `companyId` is honoured only for SUPER_ADMIN. `date` filters by bookingDate, `type` by
 * primary vs common-pool.
 */
export const listAllocationsQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
  companyId: z.string().min(1).optional(),
  type: z.enum(['PRIMARY', 'COMMON_POOL']).optional(),
});
export type ListAllocationsQuery = z.infer<typeof listAllocationsQuery>;
