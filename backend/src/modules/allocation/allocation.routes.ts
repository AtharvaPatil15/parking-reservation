import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { primaryRunSchema } from './allocation.schema';
import * as c from './allocation.controller';

// /allocation — SUPER_ADMIN only (P4-13).
const allocationRouter = Router();
allocationRouter.post('/primary/run', authenticate, requireRole('SUPER_ADMIN'), validate(primaryRunSchema), c.runPrimary);
allocationRouter.get('/runs/:id', authenticate, requireRole('SUPER_ADMIN'), c.getRun);
allocationRouter.get('/runs/:id/breakdown', authenticate, requireRole('SUPER_ADMIN'), c.getBreakdown);

export default allocationRouter;
