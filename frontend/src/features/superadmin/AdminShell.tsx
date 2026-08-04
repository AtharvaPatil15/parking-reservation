import { Outlet } from 'react-router-dom';
import { useRegisterNavDrawerItems } from '../../app/navDrawer';
import { ROLE_NAV } from '../../app/roleNav';

/** Super-admin area layout: heading + nav drawer (top bar hamburger); content routes through the Outlet. */
export function AdminShell() {
  useRegisterNavDrawerItems(ROLE_NAV.SUPER_ADMIN);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Super Admin</h1>
      <Outlet />
    </div>
  );
}
