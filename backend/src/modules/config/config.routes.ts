import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { getConfig, updateConfig } from './config.controller';

/** PATCH body: a non-empty map of config key → string value (contract §3.4). */
const updateConfigSchema = z
  .record(z.string(), z.string())
  .refine((obj) => Object.keys(obj).length > 0, { message: 'At least one key is required' });

const router = Router();

// TODO(P4-06): protect both routes with requireRole('SUPER_ADMIN') once auth (P4-05) + RBAC (P4-06) land.
router.get('/', getConfig);
router.patch('/', validate(updateConfigSchema), updateConfig);

export default router;
