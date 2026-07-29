import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { loginSchema } from './auth.schema';
import { login, refresh, logout } from './auth.controller';

const router = Router();

// Public: credentials / refresh-cookie based (no bearer token required).
router.post('/login', validate(loginSchema), login);
router.post('/refresh', refresh);
router.post('/logout', logout);

// register / verify-email / password lifecycle are MVP/Later — not implemented in this PR.

export default router;
