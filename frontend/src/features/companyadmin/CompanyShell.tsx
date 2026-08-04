import { Outlet } from 'react-router-dom';
import { useRegisterNavDrawerItems } from '../../app/navDrawer';
import { ROLE_NAV } from '../../app/roleNav';

/** Company-admin area layout: heading + nav drawer (top bar hamburger); content routes through the Outlet. */
export function CompanyShell() {
  useRegisterNavDrawerItems(ROLE_NAV.COMPANY_ADMIN);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Company Admin</h1>
      <Outlet />
    </div>
  );
}
