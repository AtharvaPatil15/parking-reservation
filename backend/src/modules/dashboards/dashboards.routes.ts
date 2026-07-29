import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/rbac';
import { superAdmin, companyAdmin, userDashboard } from './dashboards.controller';

const router = Router();

router.get('/super-admin', authenticate, requireRole('SUPER_ADMIN'), superAdmin);
router.get('/company-admin', authenticate, requireRole('COMPANY_ADMIN'), companyAdmin);
router.get('/user', authenticate, requireRole('USER'), userDashboard);

export default router;
