import { Outlet } from 'react-router-dom';
import { useRegisterNavDrawerItems } from '../../app/navDrawer';

const NAV = [
  { to: '/company', label: 'Dashboard', end: true },
  { to: '/company/allocations', label: 'Allocations' },
  { to: '/company/approvals', label: 'Approvals' },
  { to: '/company/blocks', label: 'Blocks' },
  { to: '/book', label: 'Book' },
  { to: '/my-bookings', label: 'My bookings' },
];

/** Company-admin area layout: heading + nav drawer (top bar hamburger); content routes through the Outlet. */
export function CompanyShell() {
  useRegisterNavDrawerItems(NAV);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Company Admin</h1>
      <Outlet />
    </div>
  );
}
