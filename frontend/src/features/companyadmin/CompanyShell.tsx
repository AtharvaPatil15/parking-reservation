import { Outlet } from 'react-router-dom';
import { useRegisterNavDrawerItems } from '../../app/navDrawer';
import { ROLE_NAV } from '../../app/roleNav';

/**
 * Company-admin area layout; content routes through the Outlet. The area heading
 * lives in the rail and crumb strip now, so the shell adds no heading of its own.
 */
export function CompanyShell() {
  useRegisterNavDrawerItems(ROLE_NAV.COMPANY_ADMIN);
  return (
    <div className="space-y-6">
      <Outlet />
    </div>
  );
}
