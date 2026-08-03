import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import {
  createBookingSchema,
  createBookingsBatchSchema,
  updateBookingSchema,
  releaseBookingSchema,
  listBookingsQuery,
  availabilityQuery,
} from './bookings.schema';
import * as c from './bookings.controller';

/**
 * /availability — the per-date slot grid for the caller's own company (Phase 7 §4). Every
 * authenticated role can book, so every authenticated role can see the grid.
 */
export const availabilityRouter = Router();
availabilityRouter.get('/', authenticate, validate(availabilityQuery, 'query'), c.getAvailability);

// /bookings — any authenticated role may create/own a booking (USER, COMPANY_ADMIN, SUPER_ADMIN);
// GET list is admin-only; GET/:id is visible to USER (own) / COMPANY_ADMIN (own company) / SUPER_ADMIN.
const bookingsRouter = Router();
bookingsRouter.post('/', authenticate, requireRole('USER', 'COMPANY_ADMIN', 'SUPER_ADMIN'), validate(createBookingSchema), c.createBooking);
// Multi-date: one PRIMARY request per date, independent per-date outcomes (200, never 201). Declared
// before '/:id' routes so "batch" is never parsed as a booking id.
bookingsRouter.post(
  '/batch',
  authenticate,
  requireRole('USER', 'COMPANY_ADMIN', 'SUPER_ADMIN'),
  validate(createBookingsBatchSchema),
  c.createBookingsBatch,
);
// Admin roster: COMPANY_ADMIN (own company) / SUPER_ADMIN (all, optional companyId filter).
bookingsRouter.get(
  '/',
  authenticate,
  requireRole('COMPANY_ADMIN', 'SUPER_ADMIN'),
  validate(listBookingsQuery, 'query'),
  c.listBookings,
);
bookingsRouter.patch('/:id', authenticate, requireRole('USER', 'COMPANY_ADMIN', 'SUPER_ADMIN'), validate(updateBookingSchema), c.updateBooking);
// Release an allocated slot — reallocated server-side to the own-company waitlist first, else
// cross-company by score (F3). Owner (USER) / COMPANY_ADMIN (own company) / SUPER_ADMIN (any).
bookingsRouter.post(
  '/:id/release',
  authenticate,
  requireRole('USER', 'COMPANY_ADMIN', 'SUPER_ADMIN'),
  validate(releaseBookingSchema),
  c.releaseBooking,
);
bookingsRouter.get('/:id', authenticate, requireRole('USER', 'COMPANY_ADMIN', 'SUPER_ADMIN'), c.getBooking);

export default bookingsRouter;
