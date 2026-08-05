import type { UserStatus } from '@prisma/client';
import { asyncHandler } from '../../lib/asyncHandler';
import { sendSuccess } from '../../lib/response';
import { UnauthenticatedError } from '../../lib/errors';
import { parsePagination } from '../../lib/pagination';
import { toUserProfile } from '../../lib/dto';
import * as service from './users.service';

export const listPendingAdmins = asyncHandler(async (req, res) => {
  const p = parsePagination(req.query as Record<string, unknown>);
  const { rows, total } = await service.listPendingAdmins(p);
  sendSuccess(res, rows.map(toUserProfile), 200, { page: p.page, pageSize: p.pageSize, total });
});

export const listAdminRequestHistory = asyncHandler(async (req, res) => {
  const p = parsePagination(req.query as Record<string, unknown>);
  const { rows, total } = await service.listAdminRequestHistory(p);
  sendSuccess(res, rows.map(toUserProfile), 200, { page: p.page, pageSize: p.pageSize, total });
});

/** GET /users/:id — the full applicant, for the approval screens' details dialog. */
export const getUserDetail = asyncHandler(async (req, res) => {
  if (!req.user) throw new UnauthenticatedError();
  const { user, vehicles } = await service.getUserDetail(req.user, req.params.id);
  sendSuccess(res, { ...toUserProfile(user), vehicles });
});

export const setApproval = asyncHandler(async (req, res) => {
  if (!req.user) throw new UnauthenticatedError();
  const user = await service.setApproval(
    req.user,
    req.params.id,
    (req.body as { decision: 'APPROVE' | 'REJECT' }).decision,
  );
  sendSuccess(res, toUserProfile(user));
});

export const setStatus = asyncHandler(async (req, res) => {
  if (!req.user) throw new UnauthenticatedError();
  const user = await service.setStatus(
    req.user,
    req.params.id,
    (req.body as { status: UserStatus }).status,
  );
  sendSuccess(res, toUserProfile(user));
});

export const removeUser = asyncHandler(async (req, res) => {
  if (!req.user) throw new UnauthenticatedError();
  await service.removeUser(req.user, req.params.id);
  sendSuccess(res, { message: 'User removed' });
});
