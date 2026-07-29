import { z } from 'zod';

/** Allocation request DTOs (P4-13), mirroring openapi `PrimaryRunRequest`. */
export const primaryRunSchema = z.object({
  bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
});

export type PrimaryRunInput = z.infer<typeof primaryRunSchema>;
