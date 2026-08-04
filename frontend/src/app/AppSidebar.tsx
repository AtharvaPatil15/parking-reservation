import { NavLink } from 'react-router-dom';
import { cn } from '../lib/cn';
import { useAuth } from '../lib/auth';
import type { Role } from '../lib/roles';
import { NavIcon } from './navIcons';
import { useNavDrawerItems, type NavDrawerItem } from './navDrawer';
import { ROLE_NAV } from './roleNav';
import { useSuperAdminNavCounts } from './useNavCounts';

/**
 * The steel rail: a dark plane carrying the brand, the role, the nav and the
 * signed-in user. Dark in both themes — it is its own plane, not a surface.
 *
 * Nav comes from the signed-in ROLE (see roleNav), not from whichever role shell
 * is mounted. Five routes mount the shell with no role shell inside, and those
 * screens used to render a bare brand bar with no nav at all — for SECURITY, whose
 * only route is /security, that was every screen. A shell may still override with
 * its own registered items, which is how a section can add to the rail.
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
  const registered = useNavDrawerItems();
  const chrome = user ? ROLE_CHROME[user.role] : undefined;
  const initial = user?.fullName?.charAt(0).toUpperCase() ?? '?';
  // Role-derived by default; a mounted shell's own registration wins if it has one.
  const items = registered.length > 0 ? registered : user ? ROLE_NAV[user.role] : [];

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

      {/* Counts are super-admin-only, and the hooks behind them take no `enabled`
          flag, so the counted variant is a separate component that simply never
          mounts for other roles. */}
      {user?.role === 'SUPER_ADMIN' ? (
        <CountedNav items={items} onNavigate={onNavigate} />
      ) : (
        <NavList items={items} onNavigate={onNavigate} />
      )}

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

/** The nav rows. Split out so the counted super-admin variant can wrap it. */
function NavList({ items, onNavigate }: { items: NavDrawerItem[]; onNavigate?: () => void }) {
  return (
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
            {({ isActive }) => (
              <>
                <NavIcon name={item.icon} />
                <span className="flex-1">{item.label}</span>
                {item.count != null && (
                  <span
                    className={cn(
                      'flex-none font-mono text-3xs tabular-nums',
                      isActive ? 'text-field-accent' : 'text-field-ink-3',
                    )}
                  >
                    {item.count}
                  </span>
                )}
              </>
            )}
          </NavLink>
        </div>
      ))}
    </nav>
  );
}

/**
 * Super-admin rail: the same rows with live figures on the right. Separate because
 * the count queries take no `enabled` flag, so this component simply never mounts
 * for the roles that must not run them.
 */
function CountedNav({ items, onNavigate }: { items: NavDrawerItem[]; onNavigate?: () => void }) {
  return <NavList items={useSuperAdminNavCounts(items)} onNavigate={onNavigate} />;
}
