import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Button, Drawer } from '../components';
import { cn } from '../lib/cn';
import { useAuth } from '../lib/auth';
import { Logo, ThemeToggle } from './chrome';
import { NavDrawerProvider, useNavDrawerItems } from './navDrawer';

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
        <main className="mx-auto max-w-5xl px-6 py-10">
          <Outlet />
        </main>
      </div>
    </NavDrawerProvider>
  );
}

function TopBar() {
  const { user, logout } = useAuth();
  const navItems = useNavDrawerItems();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const initial = user?.fullName?.charAt(0).toUpperCase() ?? '?';
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-surface/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
        <div className="flex items-center gap-2.5">
          {navItems.length > 0 && (
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation menu"
              className="grid h-8 w-8 place-items-center rounded-control text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
            >
              <MenuIcon />
            </button>
          )}
          <Logo />
          <span className="text-base font-semibold tracking-tight">Parking Reservation</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <span className="flex items-center gap-2 rounded-control border border-border bg-surface px-2.5 py-1 text-sm text-text-muted">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-primary-subtle text-xs font-semibold text-primary">
              {initial}
            </span>
            <span className="hidden sm:inline">{user?.fullName ?? 'Account'}</span>
          </span>
          <Button size="sm" variant="secondary" onClick={logout}>
            Sign out
          </Button>
        </div>
      </div>
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Menu">
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
