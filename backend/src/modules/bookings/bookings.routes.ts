import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { createBookingSchema, updateBookingSchema, listBookingsQuery } from './bookings.schema';
import * as c from './bookings.controller';

// /bookings — any authenticated role may create/own a booking (USER, COMPANY_ADMIN, SUPER_ADMIN);
// GET list is admin-only; GET/:id is visible to USER (own) / COMPANY_ADMIN (own company) / SUPER_ADMIN.
const bookingsRouter = Router();
bookingsRouter.post('/', authenticate, requireRole('USER', 'COMPANY_ADMIN', 'SUPER_ADMIN'), validate(createBookingSchema), c.createBooking);
// Admin roster: COMPANY_ADMIN (own company) / SUPER_ADMIN (all, optional companyId filter).
bookingsRouter.get(
  '/',
  authenticate,
  requireRole('COMPANY_ADMIN', 'SUPER_ADMIN'),
  validate(listBookingsQuery, 'query'),
  c.listBookings,
);
bookingsRouter.patch('/:id', authenticate, requireRole('USER', 'COMPANY_ADMIN', 'SUPER_ADMIN'), validate(updateBookingSchema), c.updateBooking);
bookingsRouter.get('/:id', authenticate, requireRole('USER', 'COMPANY_ADMIN', 'SUPER_ADMIN'), c.getBooking);

export default bookingsRouter;
