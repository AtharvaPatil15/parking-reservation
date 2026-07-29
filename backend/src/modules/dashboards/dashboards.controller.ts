import { asyncHandler } from '../../lib/asyncHandler';
import { sendSuccess } from '../../lib/response';
import { UnauthenticatedError } from '../../lib/errors';
import * as service from './dashboards.service';

/** Resolve the business date: ?date=YYYY-MM-DD, else today (UTC midnight). */
function resolveDate(q: unknown): Date {
  const raw = (q as { date?: string })?.date;
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T00:00:00.000Z`);
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export const superAdmin = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.superAdminDashboard(resolveDate(req.query)));
});

export const companyAdmin = asyncHandler(async (req, res) => {
  if (!req.user) throw new UnauthenticatedError();
  sendSuccess(res, await service.companyAdminDashboard(req.user.companyId, resolveDate(req.query)));
});

export const userDashboard = asyncHandler(async (req, res) => {
  if (!req.user) throw new UnauthenticatedError();
  sendSuccess(res, await service.userDashboard(req.user.id, resolveDate(req.query)));
});
