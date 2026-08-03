import { Outlet } from 'react-router-dom';
import { useRegisterNavDrawerItems } from '../../app/navDrawer';

const NAV = [
  { to: '/admin', label: 'Allocation', end: true },
  { to: '/admin/dashboard', label: 'Dashboard' },
  { to: '/admin/config', label: 'Config' },
  { to: '/admin/companies', label: 'Companies' },
  { to: '/admin/admin-requests', label: 'Admin requests' },
  { to: '/admin/slots', label: 'Slots' },
  { to: '/book', label: 'Book' },
  { to: '/my-bookings', label: 'My bookings' },
];

/** Super-admin area layout: heading + nav drawer (top bar hamburger); content routes through the Outlet. */
export function AdminShell() {
  useRegisterNavDrawerItems(NAV);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Super Admin</h1>
      <Outlet />
    </div>
  );
}
