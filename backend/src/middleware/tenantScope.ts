import type { RequestHandler } from 'express';
import { ForbiddenError, UnauthenticatedError } from '../lib/errors';

/**
 * Tenant scoping (P4-06) for routes whose company id is a path param.
 * SUPER_ADMIN is unrestricted; COMPANY_ADMIN/USER may only act on their own company.
 * Resource-level scoping (e.g. /users/:id where the id is a user, not a company) is enforced
 * in the service by loading the target and comparing companyId.
 */
export function scopeToTenantParam(param = 'id'): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(new UnauthenticatedError());
    if (req.user.role === 'SUPER_ADMIN') return next();
    if (req.params[param] !== req.user.companyId) {
      return next(new ForbiddenError("Cross-company access denied"));
    }
    next();
  };
}
