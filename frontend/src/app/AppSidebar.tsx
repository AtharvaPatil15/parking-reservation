import { NavLink } from 'react-router-dom';
import { cn } from '../lib/cn';
import { useAuth } from '../lib/auth';
import type { Role } from '../lib/roles';
import { NavIcon } from './navIcons';
import { useNavDrawerItems } from './navDrawer';

/**
 * The steel rail: a dark plane carrying the brand, the role, the nav and the
 * signed-in user. Dark in both themes — it is its own plane, not a surface.
 *
 * Purely presentational. Items come from whichever role shell is mounted (see
 * navDrawer), so the rail never knows about routes itself.
 */

/** Display strings for the rail. Labels users already know, so nothing is renamed. */
const ROLE_CHROME: Record<Role, { label: string; code: string }> = {
  SUPER_ADMIN: { label: 'Super admin', code: '/admin' },
  COMPANY_ADMIN: { label: 'Company admin', code: '/company' },
  SECURITY: { label: 'Security', code: '/security' },
  USER: { label: 'Employee', code: '/app' },
};

export function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  const items = useNavDrawerItems();
  const chrome = user ? ROLE_CHROME[user.role] : undefined;
  const initial = user?.fullName?.charAt(0).toUpperCase() ?? '?';

  return (
    <div className="flex h-full w-full flex-col bg-field text-field-ink">
      <div className="flex items-center gap-2.5 border-b border-field-ln px-4 py-4">
        <span className="grid h-[30px] w-[30px] shrink-0 place-items-center border border-field-ln2 font-heading text-lg leading-none text-field-accent">
          P
        </span>
        <span className="flex flex-col leading-[1.05]">
          <span className="font-heading text-lg uppercase tracking-[0.06em]">Parking</span>
          <span className="text-[10px] uppercase tracking-[0.22em] text-field-ink-3">Reservation</span>
        </span>
      </div>

      {chrome && (
        <div className="flex flex-col gap-px px-4 pb-2.5 pt-3.5">
          {/* The area heading proper — the role names the section you are in. */}
          <h1 className="whitespace-nowrap text-3xs font-normal uppercase tracking-[0.13em] text-field-ink-3">
            {chrome.label}
          </h1>
          <span className="font-mono text-3xs text-field-accent">{chrome.code}</span>
        </div>
      )}

      <nav className="flex flex-1 flex-col gap-px overflow-y-auto px-2.5" aria-label="Main">
        {items.map((item) => (
          <div key={item.to} className={cn(item.dividerBefore && 'mt-2.5 border-t border-field-ln pt-2.5')}>
            <NavLink
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'flex h-[34px] items-center gap-2.5 px-2.5 text-sm transition-colors',
                  isActive
                    ? 'bg-white/[0.08] text-white shadow-[inset_2px_0_0_rgb(var(--field-accent))]'
                    : 'text-field-ink-2 hover:bg-white/[0.05] hover:text-field-ink',
                )
              }
            >
              <NavIcon name={item.icon} />
              <span className="flex-1">{item.label}</span>
            </NavLink>
          </div>
        ))}
      </nav>

      <div className="mx-4 h-px bg-field-ln" />
      <div className="flex flex-col gap-2.5 px-4 pb-4 pt-3.5">
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center border border-field-ln2 font-heading text-sm text-field-accent">
            {initial}
          </span>
          <span className="flex min-w-0 flex-col leading-[1.25]">
            <span className="truncate text-sm">{user?.fullName ?? 'Account'}</span>
            {user?.companyName && (
              <span className="truncate text-[10.5px] text-field-ink-2">{user.companyName}</span>
            )}
          </span>
        </div>
        {/* The account block links to the profile, as the top bar's chip did before
            the rail replaced it. /profile is open to every role, so it always shows. */}
        <NavLink
          to="/profile"
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex h-[30px] items-center justify-center border border-field-ln2 font-heading text-sm tracking-[0.02em] transition-colors',
              isActive ? 'bg-white/[0.10] text-white' : 'text-field-ink hover:bg-white/[0.06]',
            )
          }
        >
          Profile
        </NavLink>
        <button
          type="button"
          onClick={logout}
          className="flex h-[30px] items-center justify-center border border-field-ln2 font-heading text-sm tracking-[0.02em] text-field-ink transition-colors hover:bg-white/[0.06]"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
