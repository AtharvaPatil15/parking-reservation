import { NavLink } from 'react-router-dom';
import { cn } from '../lib/cn';
import { useAuth } from '../lib/auth';
import { NavIcon } from './navIcons';
import { useNavDrawerItems, type NavDrawerItem } from './navDrawer';
import { ROLE_NAV } from './roleNav';
import { useSuperAdminNavCounts } from './useNavCounts';

/**
 * The steel rail: a dark plane carrying the brand, the nav and the signed-in
 * user. Dark in both themes — it is its own plane, not a surface.
 *
 * Nav comes from the signed-in ROLE (see roleNav), not from whichever role shell
 * is mounted. Five routes mount the shell with no role shell inside, and those
 * screens used to render a bare brand bar with no nav at all — for SECURITY, whose
 * only route is /security, that was every screen. A shell may still override with
 * its own registered items, which is how a section can add to the rail.
 *
 * `collapsed` narrows it to an icon rail (lg+ only; in the mobile drawer there is
 * no reason to collapse, so the drawer never passes it). Labels are never removed
 * when collapsed — they stay in the DOM as sr-only text with a `title` tooltip, so
 * the nav reads identically to a screen reader either way.
 */
export function AppSidebar({
  onNavigate,
  collapsed = false,
  onToggleCollapse,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { user, logout } = useAuth();
  const registered = useNavDrawerItems();
  const initial = user?.fullName?.charAt(0).toUpperCase() ?? '?';
  // Role-derived by default; a mounted shell's own registration wins if it has one.
  const items = registered.length > 0 ? registered : user ? ROLE_NAV[user.role] : [];

  return (
    <div className="flex h-full w-full flex-col bg-field text-field-ink">
      <div
        className={cn(
          'flex items-center border-b border-field-ln py-4',
          collapsed ? 'justify-center px-2' : 'gap-2.5 px-4',
        )}
      >
        <span className="grid h-[30px] w-[30px] shrink-0 place-items-center border border-field-ln2 font-heading text-lg leading-none text-field-accent">
          P
        </span>
        {!collapsed && (
          <span className="flex flex-col leading-[1.05]">
            <span className="font-heading text-lg uppercase tracking-[0.06em]">Parking</span>
            <span className="text-[11px] uppercase tracking-[0.22em] text-field-ink-3">Reservation</span>
          </span>
        )}
      </div>

      {/* The role/route plate ("SUPER ADMIN" over "/admin") used to sit here. Removed:
          the crumb strip above the content already names the role, the account block
          at the foot of the rail already says who you are, and the raw route path was
          developer-facing detail. The role heading moved to the crumb strip, which is
          the thing that actually names the area you are in. */}

      {/* Counts are super-admin-only, and the hooks behind them take no `enabled`
          flag, so the counted variant is a separate component that simply never
          mounts for other roles. */}
      {user?.role === 'SUPER_ADMIN' ? (
        <CountedNav items={items} onNavigate={onNavigate} collapsed={collapsed} />
      ) : (
        <NavList items={items} onNavigate={onNavigate} collapsed={collapsed} />
      )}

      <div className="mx-4 h-px bg-field-ln" />
      <div className={cn('flex flex-col gap-2.5 pb-4 pt-3.5', collapsed ? 'px-2' : 'px-4')}>
        <div className={cn('flex items-center', collapsed ? 'justify-center' : 'gap-2.5')}>
          <span
            className="grid h-7 w-7 shrink-0 place-items-center border border-field-ln2 font-heading text-sm text-field-accent"
            // Collapsed, the initial is the only identity on screen, so it carries
            // the name as a tooltip rather than leaving it to a hover of nothing.
            title={collapsed ? (user?.fullName ?? 'Account') : undefined}
          >
            {initial}
          </span>
          {!collapsed && (
            <span className="flex min-w-0 flex-col leading-[1.25]">
              <span className="truncate text-sm">{user?.fullName ?? 'Account'}</span>
              {user?.companyName && (
                <span className="truncate text-[11.5px] text-field-ink-2">{user.companyName}</span>
              )}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={logout}
          title={collapsed ? 'Sign out' : undefined}
          className="flex h-[30px] items-center justify-center border border-field-ln2 font-heading text-sm tracking-[0.02em] text-field-ink transition-colors hover:bg-white/[0.06]"
        >
          {/* Collapsed the rail is 60px wide, which "Sign out" does not fit — but the
              word must stay for screen readers, so it goes sr-only behind an icon. */}
          {collapsed ? (
            <>
              <SignOutIcon />
              <span className="sr-only">Sign out</span>
            </>
          ) : (
            'Sign out'
          )}
        </button>

        {/* lg-only: below that the rail lives in an off-canvas drawer, where
            collapsing it would just be a second way to hide the same thing. */}
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-expanded={!collapsed}
            className={cn(
              'hidden h-[30px] items-center gap-2 text-2xs uppercase tracking-[0.12em] text-field-ink-3 transition-colors hover:text-field-ink lg:flex',
              collapsed ? 'justify-center' : 'justify-start px-1',
            )}
          >
            <ChevronIcon flipped={collapsed} />
            {!collapsed && <span>Collapse</span>}
          </button>
        )}
      </div>
    </div>
  );
}

/** The nav rows. Split out so the counted super-admin variant can wrap it. */
function NavList({
  items,
  onNavigate,
  collapsed,
}: {
  items: NavDrawerItem[];
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  return (
    <nav
      className={cn('flex flex-1 flex-col gap-px overflow-y-auto', collapsed ? 'px-2' : 'px-2.5')}
      aria-label="Main"
    >
      {items.map((item) => (
        <div key={item.to} className={cn(item.dividerBefore && 'mt-2.5 border-t border-field-ln pt-2.5')}>
          <NavLink
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            // Collapsed there is no visible label, so the icon needs the name on hover.
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              cn(
                // `relative` anchors the collapsed count dot, which is absolutely placed.
                'relative flex h-[34px] items-center text-sm transition-colors',
                collapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5',
                isActive
                  ? // The 3px amber bar is the ONE place the action colour appears in the rail, and
                    // it is what ties the navy chrome to the amber action colour. The fill is a
                    // token step off the rail plane rather than a white alpha, so it holds in both
                    // themes instead of washing out on the darker dark-mode rail.
                    'bg-field-raised text-field-ink shadow-[inset_3px_0_0_rgb(var(--field-accent))]'
                  : 'text-field-ink-2 hover:bg-white/[0.05] hover:text-field-ink',
              )
            }
          >
            {({ isActive }) => (
              <>
                <NavIcon name={item.icon} />
                {/* The label stays in the DOM when collapsed — hiding it visually is a
                    layout choice, not a reason to drop the nav's accessible names. */}
                <span className={cn(collapsed ? 'sr-only' : 'flex-1')}>{item.label}</span>
                {item.count != null &&
                  (collapsed ? (
                    // No room for a figure beside a centred icon, so a pending count
                    // becomes a dot on the icon's corner. The number itself is still
                    // announced, via the sr-only text.
                    <>
                      <span
                        aria-hidden="true"
                        className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-field-accent"
                      />
                      <span className="sr-only">{item.count} pending</span>
                    </>
                  ) : (
                    <span
                      className={cn(
                        'flex-none font-mono text-3xs tabular-nums',
                        isActive ? 'text-field-accent' : 'text-field-ink-3',
                      )}
                    >
                      {item.count}
                    </span>
                  ))}
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
function CountedNav({
  items,
  onNavigate,
  collapsed,
}: {
  items: NavDrawerItem[];
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  return <NavList items={useSuperAdminNavCounts(items)} onNavigate={onNavigate} collapsed={collapsed} />;
}

function SignOutIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronIcon({ flipped }: { flipped?: boolean }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn('shrink-0 transition-transform', flipped && 'rotate-180')}
    >
      <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
