import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import {
  checkInSchema,
  checkOutSchema,
  createRegistrationSchema,
  gateCapacityQuery,
  gateEventsQuery,
  registrationDecisionSchema,
  registrationsQuery,
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
/**
 * Walk-in registration requests. Declared BEFORE `GET /` so `/registrations` is not swallowed by the
 * search route, and kept on /vehicles because that is the registry this feeds.
 *
 * The list is readable by all three personas but scoped differently per role in the service: an admin
 * sees the decisions they owe, a guard sees only their own submissions — which they need, because the
 * car waits at the barrier until one of those submissions comes back approved.
 */
vehiclesRouter.post(
  '/registrations',
  authenticate,
  requireRole('SECURITY'),
  validate(createRegistrationSchema),
  c.createRegistration,
);
vehiclesRouter.get(
  '/registrations',
  authenticate,
  requireRole('SECURITY', 'COMPANY_ADMIN', 'SUPER_ADMIN'),
  validate(registrationsQuery, 'query'),
  c.listRegistrations,
);
vehiclesRouter.post(
  '/registrations/:id/decision',
  authenticate,
  requireRole('COMPANY_ADMIN', 'SUPER_ADMIN'),
  validate(registrationDecisionSchema),
  c.decideRegistration,
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
/**
 * Per-company capacity for the gate's landing page. SECURITY reads every company's numbers, which is
 * the same building-wide scope they already have over the gate log (D15) — and necessary, since the
 * guard now has to judge whether a company has room before phoning an admin about a walk-in.
 */
gateRouter.get(
  '/capacity',
  authenticate,
  requireRole('SECURITY', 'SUPER_ADMIN'),
  validate(gateCapacityQuery, 'query'),
  c.getCapacity,
);
// Unbooked entries are a company-admin follow-up feed (D16), not a security screen.
gateRouter.get(
  '/unbooked',
  authenticate,
  requireRole('COMPANY_ADMIN', 'SUPER_ADMIN'),
  validate(unbookedQuery, 'query'),
  c.listUnbooked,
);
