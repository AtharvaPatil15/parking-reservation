import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/rbac';
import { scopeToTenantParam } from '../../middleware/tenantScope';
import { validate } from '../../middleware/validate';
import {
  createSlotSchema,
  updateSlotSchema,
  listSlotsQuery,
  createQuotaSchema,
  createBlockSchema,
  listBlocksQuery,
} from './slots.schema';
import * as c from './slots.controller';

// /slots — SUPER_ADMIN only
export const slotsRouter = Router();
slotsRouter.post('/', authenticate, requireRole('SUPER_ADMIN'), validate(createSlotSchema), c.createSlot);
slotsRouter.get('/', authenticate, requireRole('SUPER_ADMIN'), validate(listSlotsQuery, 'query'), c.listSlots);
slotsRouter.patch('/:id', authenticate, requireRole('SUPER_ADMIN'), validate(updateSlotSchema), c.updateSlot);

// /parking-areas — SUPER_ADMIN; feeds the slot-create area picker.
export const parkingAreasRouter = Router();
parkingAreasRouter.get('/', authenticate, requireRole('SUPER_ADMIN'), c.listParkingAreas);

// /companies/:id/quota (SA) + /companies/:id/blocks (SA any / CA own)
export const companyScopedRouter = Router();
companyScopedRouter.post('/:id/quota', authenticate, requireRole('SUPER_ADMIN'), validate(createQuotaSchema), c.createQuota);
companyScopedRouter.get('/:id/quota', authenticate, requireRole('SUPER_ADMIN'), c.listQuota);
companyScopedRouter.post(
  '/:id/blocks',
  authenticate,
  requireRole('SUPER_ADMIN', 'COMPANY_ADMIN'),
  scopeToTenantParam('id'),
  validate(createBlockSchema),
  c.createBlock,
);
companyScopedRouter.get(
  '/:id/blocks',
  authenticate,
  requireRole('SUPER_ADMIN', 'COMPANY_ADMIN'),
  scopeToTenantParam('id'),
  validate(listBlocksQuery, 'query'),
  c.listBlocks,
);

// /blocks/:id — SUPER_ADMIN (any) or COMPANY_ADMIN (own, enforced in service)
export const blockItemRouter = Router();
blockItemRouter.delete('/:id', authenticate, requireRole('SUPER_ADMIN', 'COMPANY_ADMIN'), c.deleteBlock);
