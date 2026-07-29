import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { authenticate } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/rbac';
import { getConfig, updateConfig } from './config.controller';

/** PATCH body: a non-empty map of config key → string value (contract §3.4). */
const updateConfigSchema = z
  .record(z.string(), z.string())
  .refine((obj) => Object.keys(obj).length > 0, { message: 'At least one key is required' });

const router = Router();

// SUPER_ADMIN only (P4-06 — closes finding #1: config is no longer unauthenticated).
router.get('/', authenticate, requireRole('SUPER_ADMIN'), getConfig);
router.patch('/', authenticate, requireRole('SUPER_ADMIN'), validate(updateConfigSchema), updateConfig);

export default router;
