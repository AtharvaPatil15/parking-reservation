import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/rbac';
import { scopeToTenantParam } from '../../middleware/tenantScope';
import { validate } from '../../middleware/validate';
import {
  createCompanySchema,
  updateCompanySchema,
  updateStatusSchema,
  assignAdminSchema,
  listCompaniesQuery,
  listUsersQuery,
} from './companies.schema';
import * as c from './companies.controller';

const router = Router();

// Public: registration dropdown (id + name of active companies).
router.get('/active', c.listActiveCompanies);

// Company management — SUPER_ADMIN only.
router.post('/', authenticate, requireRole('SUPER_ADMIN'), validate(createCompanySchema), c.createCompany);
router.get('/', authenticate, requireRole('SUPER_ADMIN'), validate(listCompaniesQuery, 'query'), c.listCompanies);
router.get('/:id', authenticate, requireRole('SUPER_ADMIN'), c.getCompany);
router.patch('/:id', authenticate, requireRole('SUPER_ADMIN'), validate(updateCompanySchema), c.updateCompany);
router.patch('/:id/status', authenticate, requireRole('SUPER_ADMIN'), validate(updateStatusSchema), c.setCompanyStatus);

// Company users — SUPER_ADMIN (any) or COMPANY_ADMIN (own company, tenant-scoped on :id).
router.get(
  '/:id/users',
  authenticate,
  requireRole('SUPER_ADMIN', 'COMPANY_ADMIN'),
  scopeToTenantParam('id'),
  validate(listUsersQuery, 'query'),
  c.listCompanyUsers,
);
router.post('/:id/admins', authenticate, requireRole('SUPER_ADMIN'), validate(assignAdminSchema), c.assignCompanyAdmin);

export default router;
