import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { roleHome, type Role } from './roles';

/**
 * Gate for authenticated-only areas. Unauthenticated → /login, preserving the
 * attempted path in router state so the login page can return the user there.
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
 * Gate for a specific role. Enforces auth first (→ /login), then role: a wrong-role
 * user is sent to their own home (never a dead-end, never a redirect loop).
 */
export function RequireRole({ role }: { role: Role }) {
  const { isAuthenticated, user } = useAuth();
  const location = useLocation();
  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  if (user.role !== role) {
    return <Navigate to={roleHome(user.role)} replace />;
  }
  return <Outlet />;
}
