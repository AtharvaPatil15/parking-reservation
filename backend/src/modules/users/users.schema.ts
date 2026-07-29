import { z } from 'zod';

export const approvalSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']) });
export const userStatusSchema = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) });
