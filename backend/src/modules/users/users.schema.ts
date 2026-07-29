import { z } from 'zod';

export const approvalSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']) });
// Contract's UpdateUserStatusRequest.status = full UserStatus; the ACTIVE/INACTIVE business
// rule is enforced in the service (activate/deactivate only).
export const userStatusSchema = z.object({
  status: z.enum(['PENDING', 'ACTIVE', 'REJECTED', 'INACTIVE']),
});
