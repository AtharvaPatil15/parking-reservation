import { Outlet } from 'react-router-dom';
import { useRegisterNavDrawerItems } from '../../app/navDrawer';

const NAV = [
  { to: '/company', label: 'Dashboard', end: true, icon: 'dashboard' as const },
  { to: '/company/allocations', label: 'Allocations', icon: 'grid' as const },
  { to: '/company/approvals', label: 'Approvals', icon: 'users' as const },
  { to: '/company/blocks', label: 'Blocks', icon: 'ban' as const },
  // The cross-role booking links are the admin's own parking, not company admin —
  // the rule above separates the two groups.
  { to: '/book', label: 'Book', icon: 'park' as const, dividerBefore: true },
  { to: '/my-bookings', label: 'My bookings', icon: 'history' as const },
];

/**
 * Company-admin area layout; content routes through the Outlet. The area heading
 * lives in the rail and crumb strip now, so the shell adds no heading of its own.
 */
export function CompanyShell() {
  useRegisterNavDrawerItems(NAV);
  return (
    <div className="space-y-6">
      <Outlet />
    </div>
  );
}
