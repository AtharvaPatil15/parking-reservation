import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { Button, Drawer } from '../components';
import { cn } from '../lib/cn';
import { useAuth } from '../lib/auth';
import { Logo, ThemeToggle } from './chrome';
import { NavDrawerProvider, useNavDrawerItems } from './navDrawer';
import { ROLE_NAV } from './roleNav';

/**
 * Authenticated chrome: top bar + content region. The role shells (/admin,
 * /company, /app) render through the <Outlet/>. Only mounts behind a role guard,
 * so `user` is always present here.
 */
export function AppShell() {
  return (
    <NavDrawerProvider>
      <div className="min-h-screen bg-canvas text-text">
        <TopBar />
        <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
          <Outlet />
        </main>
      </div>
    </NavDrawerProvider>
  );
}

function TopBar() {
  const { user, logout } = useAuth();
  const registeredItems = useNavDrawerItems();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const initial = user?.fullName?.charAt(0).toUpperCase() ?? '?';
  // Pages outside a role shell (/profile, the gate console) register nothing, so fall back to the
  // signed-in role's menu — the hamburger is always shown and must never open an empty drawer.
  const navItems = registeredItems.length > 0 ? registeredItems : (user ? ROLE_NAV[user.role] ?? [] : []);
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-surface/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-2 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          {/* Always rendered: pages outside a role shell (e.g. /profile) register no nav items of
              their own, and hiding the only navigation control there stranded the user. Those
              pages fall back to the role's own menu below. */}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation menu"
            className="grid h-8 w-8 place-items-center rounded-control text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            <MenuIcon />
          </button>
          <Logo />
          {/* The full wordmark wrapped to two lines at 390px and pushed the bar past its own height.
              Keep it on one line and drop the second word on the narrowest screens. */}
          <span className="truncate whitespace-nowrap text-base font-semibold tracking-tight">
            Parking<span className="hidden sm:inline"> Reservation</span>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          <Link
            to="/profile"
            aria-label="Open profile"
            className="flex items-center gap-2 rounded-control border border-border bg-surface px-2.5 py-1 text-sm text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            <span className="grid h-6 w-6 place-items-center rounded-full bg-primary-subtle text-xs font-semibold text-primary">
              {initial}
            </span>
            <span className="hidden sm:inline">{user?.fullName ?? 'Account'}</span>
          </Link>
          <Button size="sm" variant="secondary" className="whitespace-nowrap" onClick={logout}>
            Sign out
          </Button>
        </div>
      </div>
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Menu" side="left" variant="nav">
        <nav className="flex flex-col gap-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setDrawerOpen(false)}
              className={({ isActive }) =>
                cn(
                  'rounded-control px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-primary-subtle text-primary' : 'text-text-muted hover:bg-surface-2 hover:text-text',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </Drawer>
    </header>
  );
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 6h16M4 12h16M4 18h16"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
