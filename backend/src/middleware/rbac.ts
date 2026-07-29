import type { RequestHandler } from 'express';
import type { Role } from '../lib/roles';
import { ForbiddenError, UnauthenticatedError } from '../lib/errors';

/** Allow only the listed roles (P4-06). Must run after `authenticate`. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(new UnauthenticatedError());
    if (!roles.includes(req.user.role)) {
      return next(new ForbiddenError('Insufficient role for this operation'));
    }
    next();
  };
}
