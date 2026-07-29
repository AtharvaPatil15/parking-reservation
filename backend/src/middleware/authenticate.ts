import type { RequestHandler } from 'express';
import { verifyAccessToken } from '../lib/jwt';
import { UnauthenticatedError } from '../lib/errors';
import { getRequestContext } from '../lib/requestContext';

/** Verify the Bearer access token and attach the principal to req.user (+ audit context). */
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.header('authorization');
  if (!header || !header.startsWith('Bearer ')) {
    return next(new UnauthenticatedError('Missing bearer token'));
  }
  try {
    const payload = verifyAccessToken(header.slice(7));
    req.user = { id: payload.sub, role: payload.role, companyId: payload.companyId };
    const ctx = getRequestContext();
    if (ctx) ctx.actorUserId = payload.sub; // for audit (P4-10)
    next();
  } catch {
    next(new UnauthenticatedError('Invalid or expired token'));
  }
};
