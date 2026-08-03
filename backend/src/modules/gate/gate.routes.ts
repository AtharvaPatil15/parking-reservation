import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import {
  checkInSchema,
  checkOutSchema,
  gateEventsQuery,
  unbookedQuery,
  vehicleLookupQuery,
  vehicleSearchQuery,
} from './gate.schema';
import * as c from './gate.controller';

/**
 * /vehicles — the car registry the gate reads. SECURITY (their whole job) and SUPER_ADMIN (building
 * operator). Deliberately NOT tenant-scoped (D15): the guard at the barrier serves every company.
 */
export const vehiclesRouter = Router();
vehiclesRouter.get(
  '/lookup',
  authenticate,
  requireRole('SECURITY', 'SUPER_ADMIN'),
  validate(vehicleLookupQuery, 'query'),
  c.lookupVehicle,
);
vehiclesRouter.get(
  '/',
  authenticate,
  requireRole('SECURITY', 'SUPER_ADMIN'),
  validate(vehicleSearchQuery, 'query'),
  c.searchVehicles,
);

/** /gate — check-in / check-out and the visit log. */
export const gateRouter = Router();
gateRouter.post('/check-in', authenticate, requireRole('SECURITY'), validate(checkInSchema), c.checkIn);
gateRouter.post('/check-out', authenticate, requireRole('SECURITY'), validate(checkOutSchema), c.checkOut);
gateRouter.get(
  '/events',
  authenticate,
  requireRole('SECURITY', 'SUPER_ADMIN'),
  validate(gateEventsQuery, 'query'),
  c.listGateEvents,
);
// Unbooked entries are a company-admin follow-up feed (D16), not a security screen.
gateRouter.get(
  '/unbooked',
  authenticate,
  requireRole('COMPANY_ADMIN', 'SUPER_ADMIN'),
  validate(unbookedQuery, 'query'),
  c.listUnbooked,
);
