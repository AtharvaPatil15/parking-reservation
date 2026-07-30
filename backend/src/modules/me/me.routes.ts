import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { updateProfileSchema, myBookingsQuery } from './me.schema';
import { getMe, updateMe, getMyBookings } from './me.controller';

// /me — the current user's own profile + bookings. Any authenticated role (USER, COMPANY_ADMIN,
// SUPER_ADMIN) — everyone has a profile and can review their own booking history.
const router = Router();
router.get('/', authenticate, getMe);
router.patch('/', authenticate, validate(updateProfileSchema), updateMe);
router.get('/bookings', authenticate, validate(myBookingsQuery, 'query'), getMyBookings);

export default router;
