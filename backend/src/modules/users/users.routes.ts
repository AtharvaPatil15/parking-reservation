import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { approvalSchema, userStatusSchema } from './users.schema';
import { setApproval, setStatus } from './users.controller';

const router = Router();

// SUPER_ADMIN (any) or COMPANY_ADMIN (own company — enforced in the service by companyId comparison).
router.patch('/:id/approval', authenticate, requireRole('SUPER_ADMIN', 'COMPANY_ADMIN'), validate(approvalSchema), setApproval);
router.patch('/:id/status', authenticate, requireRole('SUPER_ADMIN', 'COMPANY_ADMIN'), validate(userStatusSchema), setStatus);

export default router;
