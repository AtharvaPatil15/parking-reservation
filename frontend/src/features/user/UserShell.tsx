import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '../../lib/cn';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn('text-sm transition-colors', isActive ? 'font-medium text-text' : 'text-text-muted hover:text-text');

/** User-area layout: nav + routed content. */
export function UserShell() {
  return (
    <div className="space-y-6">
      <nav className="flex gap-4 border-b border-border pb-3">
        <NavLink to="/app" end className={linkClass}>
          Dashboard
        </NavLink>
        <NavLink to="/book" className={linkClass}>
          Book a slot
        </NavLink>
        <NavLink to="/my-bookings" className={linkClass}>
          History
        </NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
