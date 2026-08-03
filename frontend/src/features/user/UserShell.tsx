import { Outlet } from 'react-router-dom';
import { useRegisterNavDrawerItems } from '../../app/navDrawer';

const NAV = [
  { to: '/app', label: 'Dashboard', end: true, icon: 'dashboard' as const },
  { to: '/book', label: 'Book a slot', icon: 'park' as const },
  { to: '/my-bookings', label: 'History', icon: 'history' as const },
];

/** User-area layout: nav rail (see AppShell) + routed content. */
export function UserShell() {
  useRegisterNavDrawerItems(NAV);
  return (
    <div className="space-y-6">
      <Outlet />
    </div>
  );
}
