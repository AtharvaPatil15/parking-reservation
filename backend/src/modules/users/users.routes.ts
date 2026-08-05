import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { approvalSchema, userStatusSchema } from './users.schema';
import {
  getUserDetail,
  listAdminRequestHistory,
  listPendingAdmins,
  removeUser,
  setApproval,
  setStatus,
} from './users.controller';

const router = Router();

// SUPER_ADMIN only — the pending company-admin registration queue (F11).
router.get('/pending-admins', authenticate, requireRole('SUPER_ADMIN'), listPendingAdmins);
// SUPER_ADMIN only — processed company-admin requests (approval history).
router.get('/admin-requests/history', authenticate, requireRole('SUPER_ADMIN'), listAdminRequestHistory);

// SUPER_ADMIN (any) or COMPANY_ADMIN (own company — enforced in the service by companyId comparison).
// Declared after the two literal paths above so `/pending-admins` is not captured as an `:id`.
router.get('/:id', authenticate, requireRole('SUPER_ADMIN', 'COMPANY_ADMIN'), getUserDetail);
router.patch('/:id/approval', authenticate, requireRole('SUPER_ADMIN', 'COMPANY_ADMIN'), validate(approvalSchema), setApproval);
router.patch('/:id/status', authenticate, requireRole('SUPER_ADMIN', 'COMPANY_ADMIN'), validate(userStatusSchema), setStatus);
router.delete('/:id', authenticate, requireRole('SUPER_ADMIN', 'COMPANY_ADMIN'), removeUser);

export default router;
