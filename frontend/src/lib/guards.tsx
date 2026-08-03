import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { roleHome, type Role } from './roles';

/**
 * Gate for authenticated-only areas. Unauthenticated → /login, preserving the
 * attempted path in router state so the login page can return the user there.
 *
 * Deliberately provided as a role-agnostic primitive for later tasks (P5-04+) that
 * need "any signed-in user" access without a role check — e.g. shared account or
 * profile views. Not currently wired into `AppRouter`, which uses `RequireRole` for
 * all of its guarded routes.
 */
export function RequireAuth() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}

/**
 * Gate for one role or a set of them. Enforces auth first (→ /login), then role: a wrong-role
 * user is sent to their own home (never a dead-end, never a redirect loop).
 *
 * The array form exists for genuinely cross-role areas (e.g. booking, which USER, COMPANY_ADMIN and
 * SUPER_ADMIN all reach but SECURITY does not). It is preferred over `RequireAuth` there, because
 * "any signed-in user" silently admits every role added later — Phase 7's SECURITY would otherwise
 * have landed on a booking form it has no use for.
 */
export function RequireRole({ role }: { role: Role | Role[] }) {
  const { isAuthenticated, user } = useAuth();
  const location = useLocation();
  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  const allowed = Array.isArray(role) ? role : [role];
  if (!allowed.includes(user.role)) {
    return <Navigate to={roleHome(user.role)} replace />;
  }
  return <Outlet />;
}
