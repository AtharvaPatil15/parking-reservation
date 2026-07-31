import { Outlet } from 'react-router-dom';
import { useRegisterNavDrawerItems } from '../../app/navDrawer';

const NAV = [
  { to: '/app', label: 'Dashboard', end: true },
  { to: '/book', label: 'Book a slot' },
  { to: '/my-bookings', label: 'History' },
];

/** User-area layout: nav drawer (top bar hamburger) + routed content. */
export function UserShell() {
  useRegisterNavDrawerItems(NAV);
  return (
    <div className="space-y-6">
      <Outlet />
    </div>
  );
}
