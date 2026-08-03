import { Link } from 'react-router-dom';
import { useOptionalAuth } from '../../lib/auth';
import { roleHome } from '../../lib/roles';

/**
 * Role-aware "← Back" link for the cross-role pages (book / my-bookings / booking detail),
 * which render outside a role shell and so have no section nav. Defaults to the caller's
 * role home so a Super/Company admin isn't sent to a USER-only route.
 */
export function BackLink({ to, label = 'Back' }: { to?: string; label?: string }) {
  const auth = useOptionalAuth();
  const dest = to ?? (auth?.user ? roleHome(auth.user.role) : '/');
  return (
    <Link to={dest} className="inline-flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-text">
      <span aria-hidden="true">←</span> {label}
    </Link>
  );
}
