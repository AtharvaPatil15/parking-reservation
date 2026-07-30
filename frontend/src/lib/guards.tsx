import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { LoadingState } from '../components';
import { useAuth } from './auth';
import { roleHome, type Role } from './roles';

/**
 * Full-screen placeholder shown while the session is being restored from the refresh cookie on a
 * cold load — prevents a guard from bouncing an about-to-be-restored user to /login.
 */
export function AuthLoading() {
  return (
    <div className="grid min-h-screen place-items-center bg-canvas text-text">
      <LoadingState label="Restoring your session…" />
    </div>
  );
}

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
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <AuthLoading />;
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
  const { isAuthenticated, user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <AuthLoading />;
  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  if (user.role !== role) {
    return <Navigate to={roleHome(user.role)} replace />;
  }
  return <Outlet />;
}
