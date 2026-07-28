import type { SystemConfiguration } from '@prisma/client';
import { asyncHandler } from '../../lib/asyncHandler';
import { sendSuccess } from '../../lib/response';
import * as service from './config.service';

const toDto = (r: SystemConfiguration) => ({
  key: r.key,
  value: r.value,
  valueType: r.valueType,
  description: r.description ?? null,
  updatedAt: r.updatedAt.toISOString(),
});

export const getConfig = asyncHandler(async (_req, res) => {
  const rows = await service.getAll();
  sendSuccess(res, rows.map(toDto));
});

export const updateConfig = asyncHandler(async (req, res) => {
  const rows = await service.updateConfig(req.body as Record<string, string>, req.user?.id);
  sendSuccess(res, rows.map(toDto));
});
