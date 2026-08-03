import { Outlet } from 'react-router-dom';
import { useRegisterNavDrawerItems } from '../../app/navDrawer';

const NAV = [
  // Phase 7: the weekly batch is the normal path, so it leads; the per-date run stays for ad-hoc use.
  { to: '/admin', label: 'Weekly run', end: true, icon: 'play' as const },
  { to: '/admin/allocation', label: 'Run by date', icon: 'calendar' as const },
  { to: '/admin/dashboard', label: 'Dashboard', icon: 'dashboard' as const },
  { to: '/admin/config', label: 'Config', icon: 'sliders' as const },
  { to: '/admin/companies', label: 'Companies', icon: 'building' as const },
  { to: '/admin/admin-requests', label: 'Admin requests', icon: 'shield' as const },
  { to: '/admin/slots', label: 'Slots', icon: 'grid' as const },
  // The cross-role booking links are the admin's own parking, not administration —
  // the rule above separates the two groups.
  { to: '/book', label: 'Book', icon: 'park' as const, dividerBefore: true },
  { to: '/my-bookings', label: 'My bookings', icon: 'history' as const },
];

/**
 * Super-admin area layout; content routes through the Outlet. The area heading
 * lives in the rail and crumb strip now, so the shell adds no heading of its own.
 */
export function AdminShell() {
  useRegisterNavDrawerItems(NAV);
  return (
    <div className="space-y-6">
      <Outlet />
    </div>
  );
}
