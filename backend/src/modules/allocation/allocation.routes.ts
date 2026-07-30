import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { primaryRunSchema, listAllocationsQuery } from './allocation.schema';
import * as c from './allocation.controller';

// /allocation — runs are SUPER_ADMIN only (P4-13, P4-17).
const allocationRouter = Router();
allocationRouter.post('/primary/run', authenticate, requireRole('SUPER_ADMIN'), validate(primaryRunSchema), c.runPrimary);
allocationRouter.post('/common-pool/run', authenticate, requireRole('SUPER_ADMIN'), validate(primaryRunSchema), c.runCommonPool);
allocationRouter.get('/runs/:id', authenticate, requireRole('SUPER_ADMIN'), c.getRun);
allocationRouter.get('/runs/:id/breakdown', authenticate, requireRole('SUPER_ADMIN'), c.getBreakdown);

// /allocations — per-slot roster. COMPANY_ADMIN (own company) / SUPER_ADMIN (all, optional filters).
export const allocationsRouter = Router();
allocationsRouter.get(
  '/',
  authenticate,
  requireRole('COMPANY_ADMIN', 'SUPER_ADMIN'),
  validate(listAllocationsQuery, 'query'),
  c.listAllocations,
);

export default allocationRouter;
