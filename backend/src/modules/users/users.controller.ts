import type { UserStatus } from '@prisma/client';
import { asyncHandler } from '../../lib/asyncHandler';
import { sendSuccess } from '../../lib/response';
import { UnauthenticatedError } from '../../lib/errors';
import { toUserProfile } from '../../lib/dto';
import * as service from './users.service';

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
