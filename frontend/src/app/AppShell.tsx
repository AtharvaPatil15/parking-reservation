import { Outlet } from 'react-router-dom';
import { Button } from '../components';
import { useAuth } from '../lib/auth';
import { Logo, ThemeToggle } from './chrome';

/**
 * Authenticated chrome: top bar + content region. The role shells (/admin,
 * /company, /app) render through the <Outlet/>. Only mounts behind a role guard,
 * so `user` is always present here.
 */
export function AppShell() {
  return (
    <div className="min-h-screen bg-canvas text-text">
      <TopBar />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <Outlet />
      </main>
    </div>
  );
}

function TopBar() {
  const { user, logout } = useAuth();
  const initial = user?.fullName?.charAt(0).toUpperCase() ?? '?';
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-surface/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
        <div className="flex items-center gap-2.5">
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
    </header>
  );
}
