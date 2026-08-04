import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { createMyVehicleSchema, updateProfileSchema, myBookingsQuery } from './me.schema';
import { createMyVehicle, getMe, getMyBookings, getMyVehicles, removeMyVehicle, updateMe } from './me.controller';

// /me — the current user's own profile + bookings. Any authenticated role (USER, COMPANY_ADMIN,
// SUPER_ADMIN) — everyone has a profile and can review their own booking history.
const router = Router();
router.get('/', authenticate, getMe);
router.patch('/', authenticate, validate(updateProfileSchema), updateMe);
router.get('/vehicles', authenticate, getMyVehicles);
router.post('/vehicles', authenticate, validate(createMyVehicleSchema), createMyVehicle);
router.delete('/vehicles/:id', authenticate, removeMyVehicle);
router.get('/bookings', authenticate, validate(myBookingsQuery, 'query'), getMyBookings);

export default router;
