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
    // A bordered control, not a bare text link: on the wide reskinned pages a
    // 13px muted link read as absent, and this is the only way back from the
    // cross-role pages, which render outside a role shell.
    <Link
      to={dest}
      className="inline-flex h-[30px] items-center gap-1.5 rounded-control border border-border px-3 font-heading text-sm font-semibold tracking-[0.01em] text-text transition-colors hover:bg-surface-2"
    >
      <span aria-hidden="true">←</span> {label}
    </Link>
  );
}
