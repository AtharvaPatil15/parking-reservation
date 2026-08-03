import { useState, type ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { Drawer } from '../components';
import { useAuth } from '../lib/auth';
import type { Role } from '../lib/roles';
import { AppSidebar } from './AppSidebar';
import { ThemeToggle } from './chrome';
import { NavDrawerProvider, useNavDrawerItems } from './navDrawer';

/**
 * Authenticated chrome: the steel rail + a crumb strip over the content region.
 * The role shells (/admin, /company, /app) render through the <Outlet/>. Only
 * mounts behind a role guard, so `user` is always present here.
 *
 * The rail is persistent from lg up and collapses to the existing off-canvas
 * Drawer below it, so small screens keep the behaviour they had.
 */
export function AppShell() {
  return (
    <NavDrawerProvider>
      <ShellFrame>
        <Outlet />
      </ShellFrame>
    </NavDrawerProvider>
  );
}

function ShellFrame({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navItems = useNavDrawerItems();

  return (
    <div className="flex min-h-screen bg-canvas text-text">
      {/* The rail is its own full-height plane: the wrapper stretches with the
          page (so short pages don't leave a light gap under it) while the inner
          panel stays pinned in view. */}
      <aside className="hidden w-[248px] shrink-0 bg-field lg:block">
        <div className="sticky top-0 h-screen">
          <AppSidebar />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <CrumbStrip onOpenNav={navItems.length > 0 ? () => setDrawerOpen(true) : undefined} />
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8 lg:px-11">{children}</main>
      </div>

      {/* Below lg the same rail rides in the drawer, so there is one nav to maintain. */}
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} side="left" variant="nav" bare>
        <AppSidebar onNavigate={() => setDrawerOpen(false)} />
      </Drawer>
    </div>
  );
}

/** Display strings for the strip. Existing terminology, so nothing is renamed. */
const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: 'Super admin',
  COMPANY_ADMIN: 'Company admin',
  SECURITY: 'Security',
  USER: 'Employee',
};

/**
 * The 52px strip above the content: where you are on the left, the account and
 * theme control on the right.
 */
function CrumbStrip({ onOpenNav }: { onOpenNav?: () => void }) {
  const { user } = useAuth();

  return (
    <header className="sticky top-0 z-20 flex h-[52px] shrink-0 items-center justify-between gap-4 border-b border-border bg-surface-2 px-6 lg:px-11">
      <div className="flex min-w-0 items-center gap-3">
        {onOpenNav && (
          <button
            type="button"
            onClick={onOpenNav}
            aria-label="Open navigation menu"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-control text-text-muted transition-colors hover:bg-surface hover:text-text lg:hidden"
          >
            <MenuIcon />
          </button>
        )}
        <span className="truncate font-mono text-2xs uppercase tracking-[0.12em] text-text-muted">
          {user ? ROLE_LABEL[user.role] : 'Parking Reservation'}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {user?.companyName && (
          <span className="hidden font-mono text-2xs uppercase tracking-[0.12em] text-text-muted sm:inline">
            {user.companyName}
          </span>
        )}
        <ThemeToggle />
      </div>
    </header>
  );
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
